import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    signaling_url = LaunchConfiguration("signaling_url")
    launch_dir = os.path.join(
        get_package_share_directory("robot_bringup"), "launch"
    )
    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "signaling_url",
                default_value="ws://localhost:3000/api/sfu",
                description="WebRTC signaling WebSocket URL on the server",
            ),
            # Demo pub/sub nodes.
            # Node(
            #     package="publisher_pkg",
            #     executable="greeter_node",
            #     respawn=True,
            #     respawn_delay=2.0,
            # ),
            # Node(
            #     package="subscriber_pkg",
            #     executable="listener_node",
            #     respawn=True,
            #     respawn_delay=2.0,
            # ),
            # Node(
            #     package="cpp_subscriber_pkg",
            #     executable="listener_node",
            #     respawn=True,
            #     respawn_delay=2.0,
            # ),
            # Sensor nodes: thruster, camera, pointcloud.
            IncludeLaunchDescription(
                PythonLaunchDescriptionSource(
                    os.path.join(launch_dir, "sensors.launch.py")
                ),
            ),
            # WebRTC producers: streamer + configurator.
            IncludeLaunchDescription(
                PythonLaunchDescriptionSource(
                    os.path.join(launch_dir, "webrtc.launch.py")
                ),
                launch_arguments={"signaling_url": signaling_url}.items(),
            ),
        ]
    )
