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
            # Four producer processes, one SFU. The three streamer nodes share
            # webrtc_streamer_pkg's bundle and each picks the labels it owns
            # with Proto4WebrtcProducer(streams=[...]); the configurator
            # generates its own from rov_config.
            #   camera_node       -> "camera"
            #   telemetry_node    -> "telemetry", "pointcloud"
            #   rpc_node          -> RovControl + Greeter rpc, no stream
            #   configurator_node -> "mission_status" + Configurator rpc
            # Kill one and only its labels go offline in the GUI.
            Node(
                package="webrtc_streamer_pkg",
                executable="camera_node",
                parameters=[{"signaling_url": signaling_url}],
                respawn=True,
                respawn_delay=2.0,
            ),
            Node(
                package="webrtc_streamer_pkg",
                executable="telemetry_node",
                parameters=[{"signaling_url": signaling_url}],
                respawn=True,
                respawn_delay=2.0,
            ),
            Node(
                package="webrtc_streamer_pkg",
                executable="rpc_node",
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
