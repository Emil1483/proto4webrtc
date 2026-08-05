"""Telemetry producer node: the data streams.

  * /thrusters         (my_interfaces/Thrusters)   -> "telemetry" (unreliable)
  * /pointcloud/points (sensor_msgs/PointCloud2)   -> "pointcloud" (reliable)

Owns exactly those two labels of this package's bundle:

    streams=[ThrustersProducer, PointCloudProducer]

Point clouds require the packed little-endian float32 x,y,z layout
pointcloud_node publishes. The pointcloud channel is reliable+ordered because a
cloud fragments into many SCTP chunks and unreliable delivery loses most of
them; newest-wins is enforced sender-side by the generated wrapper dropping
clouds while the channel still buffers earlier ones.
"""

import rclpy
from sensor_msgs.msg import PointCloud2

from my_interfaces.msg import Thrusters as RosThrusters

from proto4webrtc_gen import (
    PointCloud,
    PointCloudProducer,
    Proto4WebrtcProducer,
    Thrusters,
    ThrustersProducer,
)
from rov.streams.pointcloud_pb2 import XYZ_F32

from webrtc_streamer_pkg.producer_node import ProducerNode, run


class TelemetryNode(ProducerNode):
    def __init__(self):
        super().__init__("webrtc_telemetry_node")
        self.client = Proto4WebrtcProducer(
            signaling_url=self.signaling_url,
            token=self.token,
            streams=[ThrustersProducer, PointCloudProducer],
            logger=self.get_logger(),
        )

        self.create_subscription(RosThrusters, "thrusters", self.on_thrusters, 10)
        # depth 1: clouds are big and only the newest matters
        self.create_subscription(
            PointCloud2, "pointcloud/points", self.on_pointcloud, 1
        )
        self._warned_pointcloud_layout = False
        self.get_logger().info(
            f"webrtc_telemetry_node started, signaling: {self.signaling_url}"
        )

    def on_thrusters(self, msg: RosThrusters):
        # my_interfaces/msg/Thrusters is generated from the same proto as the
        # protobuf Thrusters below, so this is a field-for-field copy.
        self.client.thrusters.send(
            Thrusters(
                stamp=msg.stamp,
                value0=msg.value0,
                value1=msg.value1,
                value2=msg.value2,
                value3=msg.value3,
            )
        )

    def on_pointcloud(self, msg: PointCloud2):
        # The node forwards msg.data verbatim, so it requires the packed
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
    run(TelemetryNode())


if __name__ == "__main__":
    main()
