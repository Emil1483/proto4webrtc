from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            Node(
                package="thruster_pkg",
                executable="thruster_node",
                respawn=True,
                respawn_delay=2.0,
            ),
            Node(
                package="camera_pkg",
                executable="synthetic_camera_node",
                respawn=True,
                respawn_delay=2.0,
            ),
            Node(
                package="pointcloud_pkg",
                executable="pointcloud_node",
                respawn=True,
                respawn_delay=2.0,
            ),
        ]
    )
