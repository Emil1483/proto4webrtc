"""ROS2 interface generation: protofiles -> `.msg` / `.srv`.

Optional and self-contained -- importing it is what pulls it in, so non-ROS
users of proto4webrtc-codegen never touch this code and it adds no dependency
beyond what the package already needs (protobuf, grpcio-tools).

Drive it from an ament interface package's CMakeLists at configure time:

    execute_process(COMMAND ${Python3_EXECUTABLE} -m proto4webrtc_codegen.ros2
                    --proto ${PROTO_DIR} --out ${CMAKE_CURRENT_SOURCE_DIR})

or from Python:

    from proto4webrtc_codegen.ros2 import generate_interfaces
    generate_interfaces(proto_dir, package_dir, include=["telemetry/*.proto"])
"""

from proto4webrtc_codegen.ros2.generator import Ros2GenError, generate_interfaces

__all__ = ["Ros2GenError", "generate_interfaces"]
