"""Camera producer node: /camera/image_raw (sensor_msgs/Image, rgb8) -> "camera".

One of three producer processes built from this package, all sharing the
bundle its setup.py generates (rov/streams + rov/rpc). This one owns a single
label:

    streams=[CameraStreamProducer]

so the labels this node does not own stay untouched by it -- another process
produces them, and a stray call to e.g. client.thrusters.send() here raises
instead of silently going nowhere. Video is the stream most likely to take a
process down (encoder, camera driver), which is exactly why it runs alone:
kill it and telemetry keeps flowing, the GUI just marks "camera" offline.
"""

import numpy as np

import rclpy
from sensor_msgs.msg import Image

from proto4webrtc_gen import CameraStreamProducer, Proto4WebrtcProducer

from webrtc_streamer_pkg.producer_node import ProducerNode, run


class CameraNode(ProducerNode):
    def __init__(self):
        super().__init__("webrtc_camera_node")
        self.client = Proto4WebrtcProducer(
            signaling_url=self.signaling_url,
            token=self.token,
            streams=[CameraStreamProducer],
            logger=self.get_logger(),
        )
        self.create_subscription(Image, "camera/image_raw", self.on_image, 10)
        self.get_logger().info(
            f"webrtc_camera_node started, signaling: {self.signaling_url}"
        )

    def on_image(self, msg: Image):
        arr = np.frombuffer(bytes(msg.data), dtype=np.uint8).reshape(
            msg.height, msg.width, 3
        )
        self.client.camera_stream.push(arr)


def main(args=None):
    rclpy.init(args=args)
    run(CameraNode())


if __name__ == "__main__":
    main()
