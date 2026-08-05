"""Shared boilerplate for the producer nodes in this package.

Each node owns a slice of the stream bundle (see the package docstrings): it
declares the same two parameters, builds a Proto4WebrtcProducer restricted to
its own streams/rpcs, and runs rclpy on a background thread while
run_forever() owns the main thread.
"""

import os
import threading

import rclpy
from rclpy.node import Node

DEFAULT_SIGNALING_URL = "ws://localhost:3000/api/sfu"


class ProducerNode(Node):
    """Node with the signaling parameters every producer node needs."""

    def __init__(self, name: str):
        super().__init__(name)
        self.declare_parameter("signaling_url", DEFAULT_SIGNALING_URL)
        # Robot auth token, sent as "Authorization: Bearer <token>"; empty
        # disables auth. Must match the server's ROBOT_TOKEN.
        self.declare_parameter("token", os.environ.get("ROBOT_TOKEN", ""))

    @property
    def signaling_url(self) -> str:
        return self.get_parameter("signaling_url").get_parameter_value().string_value

    @property
    def token(self) -> str | None:
        return (
            self.get_parameter("token").get_parameter_value().string_value or None
        )


def run(node: ProducerNode) -> None:
    """Spin rclpy on a background thread, the producer loop on this one.

    send()/push() are safe to call from the ROS callback thread directly -- the
    runtime marshals them onto the producer's event loop.
    """
    ros_thread = threading.Thread(target=rclpy.spin, args=(node,), daemon=True)
    ros_thread.start()
    try:
        # blocking: connects, reconnects on drop, until KeyboardInterrupt
        node.client.run_forever()
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
