"""Rpc producer node: serves RovControl and Greeter, produces no stream.

Third process built from this package. Rpc services are opt-in the same way
streams are -- only the ones handed to Proto4WebrtcProducer have their
"<label>/requests" channels consumed here -- so this node passes
``streams=[]``: it owns no data/media label at all, just the two services.

Greeter is a pure relay onto the ROS2 service /greet (served by
publisher_pkg's greet_service_node), so a browser rpc can end up answered by a
node that speaks no WebRTC at all.
"""

import asyncio

import rclpy
from rclpy.node import Node

from my_interfaces.srv import Greet as RosGreet

from proto4webrtc_gen import (
    GreeterBase,
    GreetRequest,
    GreetResponse,
    PingRequest,
    PingResponse,
    Proto4WebrtcProducer,
    RovControlBase,
    SetLightRequest,
    SetLightResponse,
)

from webrtc_streamer_pkg.producer_node import ProducerNode, run


class RovControl(RovControlBase):
    """The browser's rpc calls land here (on the producer's asyncio loop)."""

    def __init__(self, node: Node):
        super().__init__()
        self._node = node
        self._light = 0.0

    async def set_light(self, request: SetLightRequest) -> SetLightResponse:
        self._light = min(max(request.intensity, 0.0), 1.0)
        self._node.get_logger().info(f"light -> {self._light:.2f}")
        return SetLightResponse(intensity=self._light)

    async def ping(self, request: PingRequest) -> PingResponse:
        self._node.get_logger().info(f"ping {request.stamp}")
        return PingResponse(stamp=request.stamp)


class Greeter(GreeterBase):
    """Relay: browser rpc -> the ROS2 service /greet -> greet_service_node.

    Nothing is computed here. my_interfaces/srv/Greet is generated from the same
    proto/rov/rpc/greeter.proto that generated this rpc's request/response, so
    the two shapes match field for field and the handler only has to forward.

    The ROS2 client's future is completed by the executor on the rclpy spin
    thread, while this coroutine runs on the producer's asyncio loop, so it
    polls the future instead of blocking the loop -- calling
    rclpy.spin_until_future_complete() from here would deadlock the loop that
    the WebRTC channels themselves run on.
    """

    TIMEOUT_S = 5.0
    POLL_S = 0.01

    def __init__(self, node: Node):
        super().__init__()
        self._node = node
        self._client = node.create_client(RosGreet, "greet")

    async def greet(self, request: GreetRequest) -> GreetResponse:
        if not self._client.service_is_ready():
            # Raised, not swallowed: the exception travels back to the browser
            # as an rpc error, so the GUI can say the service is down.
            raise RuntimeError("ROS2 service /greet is not available")

        future = self._client.call_async(RosGreet.Request(name=request.name))
        waited = 0.0
        while not future.done():
            if waited >= self.TIMEOUT_S:
                future.cancel()
                raise TimeoutError(f"/greet did not answer in {self.TIMEOUT_S:.0f} s")
            await asyncio.sleep(self.POLL_S)
            waited += self.POLL_S

        result = future.result()
        assert result is not None, "ROS2 service /greet returned None"
        self._node.get_logger().info(f"greet relayed: {result.message}")
        return GreetResponse(message=result.message, count=result.count)


class RpcNode(ProducerNode):
    def __init__(self):
        super().__init__("webrtc_rpc_node")
        self.client = Proto4WebrtcProducer(
            signaling_url=self.signaling_url,
            token=self.token,
            streams=[],  # rpc only: this process produces no data/media stream
            rov_control=RovControl(self),
            # Served by another node entirely: this one only relays (see Greeter).
            greeter=Greeter(self),
            logger=self.get_logger(),
        )
        self.get_logger().info(
            f"webrtc_rpc_node started, signaling: {self.signaling_url}"
        )


def main(args=None):
    rclpy.init(args=args)
    run(RpcNode())


if __name__ == "__main__":
    main()
