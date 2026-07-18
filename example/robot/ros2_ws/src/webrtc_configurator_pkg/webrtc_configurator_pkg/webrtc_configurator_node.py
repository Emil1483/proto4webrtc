"""Configurator node — the SECOND WebRTC producer on the robot.

Runs beside webrtc_streamer_node (same container, separate process) and
connects to the same SFU. It owns only the streams generated from
rov_config (note the import: rov_config_gen, this package's own generated
wrapper — see setup.py):

  * "mission_status"  — 1 Hz heartbeat data stream (doubles as this
                        process's liveness signal in the GUI)
  * "configurator"    — rpc service: GetMission / UpdateMission

The streamer never produces these labels (its codegen is restricted to
rov/streams + rov/rpc), so the two processes split the label namespace
cleanly.
"""

import os
import threading

import rclpy
from rclpy.node import Node

from rov_config_gen import (
    ConfiguratorBase,
    GetMissionRequest,
    Mission,
    MissionStatus,
    Proto4WebrtcProducer,
    UpdateMissionRequest,
)

DEFAULT_SIGNALING_URL = "ws://localhost:3000/api/sfu"


class Configurator(ConfiguratorBase):
    """Browser rpc calls land here (on the producer's asyncio loop)."""

    def __init__(self, node: Node):
        super().__init__()
        self._node = node
        self._mission = Mission(
            name="hold-station", depths=[0.5, 1.0, 1.5], revision=1
        )

    @property
    def mission(self) -> Mission:
        return self._mission

    async def get_mission(self, request: GetMissionRequest) -> Mission:
        return self._mission

    async def update_mission(self, request: UpdateMissionRequest) -> Mission:
        if not request.name:
            # Travels back to the browser as an rpc error.
            raise ValueError("mission name must not be empty")
        self._mission = Mission(
            name=request.name,
            depths=list(request.depths),
            revision=self._mission.revision + 1,
        )
        self._node.get_logger().info(
            f"mission -> {self._mission.name} (rev {self._mission.revision})"
        )
        return self._mission


class WebRtcConfiguratorNode(Node):
    def __init__(self):
        super().__init__("webrtc_configurator_node")
        self.declare_parameter("signaling_url", DEFAULT_SIGNALING_URL)
        signaling_url = (
            self.get_parameter("signaling_url").get_parameter_value().string_value
        )
        self.configurator = Configurator(self)
        # Robot auth token (JWT, role "robot"); empty disables auth.
        self.declare_parameter("token", os.environ.get("PROTO4WEBRTC_TOKEN", ""))
        token = self.get_parameter("token").get_parameter_value().string_value
        self.client = Proto4WebrtcProducer(
            signaling_url=signaling_url,
            token=token or None,
            configurator=self.configurator,
            logger=self.get_logger(),
        )
        self._started = self.get_clock().now()
        # 1 Hz heartbeat. send() is called from the ROS timer thread —
        # thread-safe, and a no-op while the client is offline.
        self.create_timer(1.0, self.on_heartbeat)
        self.get_logger().info(
            f"WebRtcConfiguratorNode started, signaling: {signaling_url}"
        )

    def on_heartbeat(self):
        now = self.get_clock().now()
        self.client.mission_status.send(
            MissionStatus(
                stamp=now.nanoseconds * 1e-9,
                mission=self.configurator.mission,
                uptime=(now - self._started).nanoseconds * 1e-9,
            )
        )


def main(args=None):
    rclpy.init(args=args)
    node = WebRtcConfiguratorNode()

    ros_thread = threading.Thread(target=rclpy.spin, args=(node,), daemon=True)
    ros_thread.start()

    try:
        node.client.run_forever()  # blocking: connects, reconnects on drop
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
