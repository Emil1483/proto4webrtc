import rclpy
from rclpy.node import Node
from my_interfaces.msg import Greeting


class GreeterNode(Node):
    def __init__(self):
        super().__init__('greeter_node')
        self.publisher = self.create_publisher(Greeting, 'greetings', 10)
        self.timer = self.create_timer(1.0, self.publish_greeting)
        self.count = 0
        self.get_logger().info('GreeterNode started, publishing to /greetings')

    def publish_greeting(self):
        msg = Greeting()
        msg.sender = self.get_name()
        msg.message = f'Hello from greeter! (count: {self.count})'
        msg.count = self.count
        self.publisher.publish(msg)
        self.get_logger().info(f'Published: "{msg.message}"')
        self.count += 1


def main(args=None):
    rclpy.init(args=args)
    node = GreeterNode()
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
