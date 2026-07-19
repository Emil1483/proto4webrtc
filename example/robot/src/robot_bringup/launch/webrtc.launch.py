from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    signaling_url = LaunchConfiguration("signaling_url")
    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "signaling_url",
                default_value="ws://localhost:3000/api/sfu",
                description="WebRTC signaling WebSocket URL on the server",
            ),
            # Two producer processes, one SFU: the streamer owns telemetry/
            # camera/pointcloud + RovControl, the configurator owns
            # mission_status + Configurator. Kill one and only its labels go
            # offline in the GUI.
            Node(
                package="webrtc_streamer_pkg",
                executable="webrtc_streamer_node",
                parameters=[{"signaling_url": signaling_url}],
                respawn=True,
                respawn_delay=2.0,
            ),
            Node(
                package="webrtc_configurator_pkg",
                executable="webrtc_configurator_node",
                parameters=[{"signaling_url": signaling_url}],
                respawn=True,
                respawn_delay=2.0,
            ),
        ]
    )
