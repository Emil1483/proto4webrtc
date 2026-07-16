from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            Node(
                package="publisher_pkg",
                executable="greeter_node",
                respawn=True,
                respawn_delay=2.0,
            ),
            Node(
                package="subscriber_pkg",
                executable="listener_node",
                respawn=True,
                respawn_delay=2.0,
            ),
            Node(
                package="cpp_subscriber_pkg",
                executable="listener_node",
                respawn=True,
                respawn_delay=2.0,
            ),
        ]
    )
