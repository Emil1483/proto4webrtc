"""WebRTC streamer node (mediasoup producer).

The robot side of the SFU. Connects to the mediasoup signaling endpoint and
*produces*:

  * /camera/image_raw  (sensor_msgs/Image, rgb8)     -> camera_stream "camera"
  * /thrusters         (my_interfaces/Thrusters)     -> thrusters "telemetry" (unreliable)
  * /pointcloud/points (sensor_msgs/PointCloud2)     -> point_cloud "pointcloud" (reliable)

Proto4WebrtcProducer (pip package proto4webrtc) owns signaling, the mediasoup
device/transport lifecycle, and the reconnect loop. Point clouds require the
packed little-endian float32 x,y,z layout pointcloud_node publishes. The
pointcloud channel is reliable+ordered because a cloud fragments into many
SCTP chunks and unreliable delivery loses most of them; newest-wins is
enforced sender-side by the generated wrapper dropping clouds while the
channel still buffers earlier ones.

Browsers consume these selectively via the server. rclpy runs in a background
thread; Proto4WebrtcProducer.run_forever() runs the mediasoup asyncio loop in
the main thread. send()/push() are safe to call from the ROS callback thread
directly — no manual thread-marshaling needed.
"""

import threading

import numpy as np

import rclpy
from rclpy.node import Node

from sensor_msgs.msg import Image, PointCloud2
from my_interfaces.msg import Thrusters as RosThrusters

from proto4webrtc_gen import PointCloud, Proto4WebrtcProducer, Thrusters
from rov.streams.pointcloud_pb2 import XYZ_F32

DEFAULT_SIGNALING_URL = "ws://localhost:3000/api/sfu"


class WebRtcStreamerNode(Node):
    def __init__(self):
        super().__init__("webrtc_streamer_node")
        self.declare_parameter("signaling_url", DEFAULT_SIGNALING_URL)
        signaling_url = (
            self.get_parameter("signaling_url").get_parameter_value().string_value
        )
        self.client = Proto4WebrtcProducer(
            signaling_url=signaling_url, logger=self.get_logger()
        )

        self.create_subscription(Image, "camera/image_raw", self.on_image, 10)
        self.create_subscription(RosThrusters, "thrusters", self.on_thrusters, 10)
        # depth 1: clouds are big and only the newest matters
        self.create_subscription(
            PointCloud2, "pointcloud/points", self.on_pointcloud, 1
        )
        self._warned_pointcloud_layout = False
        self.get_logger().info(
            f"WebRtcStreamerNode started, signaling: {signaling_url}"
        )

    # --- ROS callbacks (rclpy spin thread) --------------------------------

    def on_image(self, msg: Image):
        arr = np.frombuffer(bytes(msg.data), dtype=np.uint8).reshape(
            msg.height, msg.width, 3
        )
        self.client.camera_stream.push(arr)

    def on_thrusters(self, msg: RosThrusters):
        stamp = msg.header.stamp.sec + msg.header.stamp.nanosec * 1e-9
        values = list(msg.values)
        self.client.thrusters.send(
            Thrusters(
                stamp=stamp,
                value0=values[0],
                value1=values[1],
                value2=values[2],
                value3=values[3],
            )
        )

    def on_pointcloud(self, msg: PointCloud2):
        # The streamer forwards msg.data verbatim, so it requires the packed
        # float32 x,y,z layout pointcloud_node publishes.
        if msg.point_step != 12 or msg.is_bigendian:
            if not self._warned_pointcloud_layout:
                self._warned_pointcloud_layout = True
                self.get_logger().warn(
                    "pointcloud dropped: expected packed little-endian float32 "
                    f"x,y,z (point_step 12), got point_step {msg.point_step}"
                )
            return
        stamp = msg.header.stamp.sec + msg.header.stamp.nanosec * 1e-9
        count = len(msg.data) // msg.point_step
        self.client.point_cloud.send(
            PointCloud(
                stamp=stamp,
                format=XYZ_F32,
                count=count,
                data=bytes(msg.data),
            )
        )


def main(args=None):
    rclpy.init(args=args)
    node = WebRtcStreamerNode()

    ros_thread = threading.Thread(target=rclpy.spin, args=(node,), daemon=True)
    ros_thread.start()

    try:
        node.client.run_forever()  # blocking: connects, reconnects on drop, until KeyboardInterrupt
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
