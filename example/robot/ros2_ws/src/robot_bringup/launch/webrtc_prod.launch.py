"""Production WebRTC streamer launch — connects to the deployed Linode server.

Use this on the real robot. For local development use webrtc.launch.py
(defaults to ws://localhost:3000/api/sfu).
"""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

PROD_SIGNALING_URL = "wss://web-rtc-test.linode.djupvik.dev/api/sfu"


def generate_launch_description():
    signaling_url = LaunchConfiguration("signaling_url")
    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "signaling_url",
                default_value=PROD_SIGNALING_URL,
                description="mediasoup signaling WebSocket URL on the server",
            ),
            Node(
                package="webrtc_streamer_pkg",
                executable="webrtc_streamer_node",
                parameters=[{"signaling_url": signaling_url}],
                respawn=True,
                respawn_delay=2.0,
            ),
        ]
    )
