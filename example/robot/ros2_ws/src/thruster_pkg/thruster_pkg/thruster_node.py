"""Thruster node.

Publishes 4 thruster values at 100 Hz on /thrusters. Values are smooth sine
waves at distinct frequencies/phases so the realtime plot in the browser has
something lively to show. This is the high-frequency telemetry source the
WebRTC streamer forwards over a data channel.
"""

import math

import rclpy
from rclpy.node import Node

from my_interfaces.msg import Thrusters


class ThrusterNode(Node):
    def __init__(self):
        super().__init__("thruster_node")
        self.declare_parameter("rate_hz", 100.0)
        rate = self.get_parameter("rate_hz").get_parameter_value().double_value

        self.publisher = self.create_publisher(Thrusters, "thrusters", 10)
        self.dt = 1.0 / rate
        self.t = 0.0
        self.timer = self.create_timer(self.dt, self.tick)
        self.get_logger().info(f"ThrusterNode publishing /thrusters at {rate} Hz")

    def tick(self):
        self.t += self.dt
        msg = Thrusters()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = "thrusters"
        msg.values = [
            math.sin(2 * math.pi * 0.5 * self.t),
            math.sin(2 * math.pi * 0.7 * self.t + 1.0),
            math.cos(2 * math.pi * 0.3 * self.t),
            0.5 * math.sin(2 * math.pi * 1.1 * self.t),
        ]
        self.publisher.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = ThrusterNode()
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
