"""A plain ROS2 service server -- the far end of a relayed browser rpc.

It knows nothing about WebRTC, proto4webrtc or the SFU: it serves
my_interfaces/srv/Greet on /greet, and that interface happens to be generated
from proto/rov/rpc/greeter.proto by proto4webrtc_codegen.ros2. rpc_node
(webrtc_streamer_pkg) implements the browser-facing Greeter rpc by calling this
service and returning its answer, so browser calls land here.

That is how an rpc gets served by whichever node owns the logic, instead of
everything having to live in the process that holds the WebRTC connection.
"""

import rclpy
from rclpy.node import Node

from my_interfaces.srv import Greet


class GreetServiceNode(Node):
    def __init__(self):
        super().__init__("greet_service_node")
        self.count = 0
        self.service = self.create_service(Greet, "greet", self.on_greet)
        self.get_logger().info("GreetServiceNode started, serving /greet")

    def on_greet(self, request: Greet.Request, response: Greet.Response):
        self.count += 1
        who = request.name or "anonymous"
        response.message = f"Hello {who}, from {self.get_name()}!"
        response.count = self.count
        self.get_logger().info(f'greet #{self.count} from "{who}"')
        return response


def main(args=None):
    rclpy.init(args=args)
    node = GreetServiceNode()
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
