"""Synthetic point cloud node.

Publishes an animated point cloud as sensor_msgs/PointCloud2 on
/pointcloud/points. No real sensor needed — points are generated with numpy.
This is the cloud the WebRTC streamer forwards to browsers as a data producer.

The scene is an animated wave surface (like a seabed sonar sweep) plus a
rotating helix above it, so both shape and motion are obvious in the browser.

Layout is the simplest possible PointCloud2: unorganized (height=1), packed
float32 x,y,z (point_step=12, little-endian). The streamer relies on exactly
this layout — it forwards msg.data as-is.
"""

import numpy as np

import rclpy
from rclpy.node import Node

from sensor_msgs.msg import PointCloud2, PointField


class PointCloudNode(Node):
    def __init__(self):
        super().__init__("pointcloud_node")
        self.declare_parameter("rate", 40.0)
        self.declare_parameter("grid", 48)  # wave surface is grid x grid points

        self.rate = self.get_parameter("rate").get_parameter_value().double_value
        grid = self.get_parameter("grid").get_parameter_value().integer_value

        self.publisher = self.create_publisher(PointCloud2, "pointcloud/points", 1)
        self.frame = 0

        # Precompute the static parts of the scene.
        xs = np.linspace(-1.0, 1.0, grid, dtype=np.float32)
        gx, gy = np.meshgrid(xs, xs)
        self.grid_x = gx.ravel()  # (grid^2,)
        self.grid_y = gy.ravel()
        self.helix_s = np.linspace(0.0, 4.0 * np.pi, 600, dtype=np.float32)

        self.fields = [
            PointField(name=n, offset=o, datatype=PointField.FLOAT32, count=1)
            for n, o in (("x", 0), ("y", 4), ("z", 8))
        ]

        self.timer = self.create_timer(1.0 / self.rate, self.tick)
        n_points = self.grid_x.size + self.helix_s.size
        self.get_logger().info(
            f"PointCloudNode publishing /pointcloud/points "
            f"{n_points} points @ {self.rate} Hz"
        )

    def tick(self):
        t = self.frame / self.rate
        two_pi = 2.0 * np.pi

        # Wave surface: z = ripples travelling across the grid.
        wave_z = 0.15 * np.sin(two_pi * (self.grid_x + 0.20 * t)) + 0.10 * np.sin(
            two_pi * (1.5 * self.grid_y + 0.30 * t)
        )
        surface = np.stack([self.grid_x, self.grid_y, wave_z - 0.4], axis=-1)

        # Helix spinning above the surface.
        s = self.helix_s
        angle = s + two_pi * 0.10 * t
        helix = np.stack(
            [
                0.5 * np.cos(angle),
                0.5 * np.sin(angle),
                0.4 * (s / s[-1]) + 0.1 * np.sin(two_pi * 0.25 * t),
            ],
            axis=-1,
        )

        points = np.concatenate([surface, helix]).astype(np.float32)

        msg = PointCloud2()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = "pointcloud"
        msg.height = 1
        msg.width = points.shape[0]
        msg.fields = self.fields
        msg.is_bigendian = False
        msg.point_step = 12
        msg.row_step = 12 * points.shape[0]
        msg.data = points.tobytes()
        msg.is_dense = True
        self.publisher.publish(msg)
        self.frame += 1


def main(args=None):
    rclpy.init(args=args)
    node = PointCloudNode()
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
