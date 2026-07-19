import random
import rclpy
from rclpy.node import Node
from my_interfaces.msg import Greeting
from rich.pretty import pretty_repr


class ListenerNode(Node):
    def __init__(self):
        super().__init__('listener_node')
        self.subscription = self.create_subscription(
            Greeting,
            'greetings',
            self.on_greeting,
            10,
        )
        self.data = [0] * 10
        self.get_logger().info('ListenerNode started, subscribing to /greetings')

    def on_greeting(self, msg: Greeting):
        self.data[random.randint(0, len(self.data) - 1)] = msg.count
        self.get_logger().info(pretty_repr(self.data))

        # if msg.count == 3:
            # raise Exception('Simulated error after receiving 3 messages')


def main(args=None):
    rclpy.init(args=args)
    node = ListenerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
