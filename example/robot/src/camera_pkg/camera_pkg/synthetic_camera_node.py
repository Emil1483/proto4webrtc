"""Synthetic camera node.

Publishes an animated RGB test pattern as sensor_msgs/Image on
/camera/image_raw. No real camera or OpenCV needed — frames are generated with
numpy. This is the video source the WebRTC streamer encodes into a media track.

The pattern is an animated plasma plus a bouncing white box, so motion and
color are both obvious when judging latency/quality in the browser.
"""

import numpy as np

import rclpy
from rclpy.node import Node

from sensor_msgs.msg import Image


class SyntheticCameraNode(Node):
    def __init__(self):
        super().__init__("synthetic_camera_node")
        self.declare_parameter("width", 640)
        self.declare_parameter("height", 480)
        self.declare_parameter("fps", 30.0)

        self.width = self.get_parameter("width").get_parameter_value().integer_value
        self.height = self.get_parameter("height").get_parameter_value().integer_value
        fps = self.get_parameter("fps").get_parameter_value().double_value

        self.publisher = self.create_publisher(Image, "camera/image_raw", 10)
        self.frame = 0
        self.fps = fps

        # Precompute normalized coordinate grids (row/col) for the pattern.
        xs = np.linspace(0.0, 1.0, self.width, dtype=np.float32)
        ys = np.linspace(0.0, 1.0, self.height, dtype=np.float32)
        self.x = xs[None, :]  # 1 x W
        self.y = ys[:, None]  # H x 1

        self.timer = self.create_timer(1.0 / fps, self.tick)
        self.get_logger().info(
            f"SyntheticCameraNode publishing /camera/image_raw "
            f"{self.width}x{self.height} @ {fps} fps"
        )

    def tick(self):
        t = self.frame / self.fps
        two_pi = 2.0 * np.pi

        r = 0.5 + 0.5 * np.sin(two_pi * (self.x + 0.20 * t))
        g = 0.5 + 0.5 * np.sin(two_pi * (self.y + 0.15 * t))
        b = 0.5 + 0.5 * np.sin(two_pi * (self.x + self.y + 0.10 * t))
        # r/g/b broadcast from (1,W)/(H,1)/(H,W) to a common (H,W) before stacking.
        r, g, b = np.broadcast_arrays(r, g, b)
        img = (np.stack([r, g, b], axis=-1) * 255.0).astype(np.uint8)

        # Bouncing white box for unambiguous motion.
        box = 48
        px = int((0.5 + 0.45 * np.sin(two_pi * 0.13 * t)) * (self.width - box))
        py = int((0.5 + 0.45 * np.sin(two_pi * 0.17 * t)) * (self.height - box))
        img[py : py + box, px : px + box] = (255, 255, 255)

        msg = Image()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = "camera"
        msg.height = self.height
        msg.width = self.width
        msg.encoding = "rgb8"
        msg.is_bigendian = 0
        msg.step = self.width * 3
        msg.data = img.tobytes()
        self.publisher.publish(msg)
        self.frame += 1


def main(args=None):
    rclpy.init(args=args)
    node = SyntheticCameraNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
