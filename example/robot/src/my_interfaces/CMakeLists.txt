# my_interfaces -- the workspace's ROS2 messages and services, generated from
# /proto.
#
# proto4webrtc_codegen.ros2 runs at CMake *configure* time, so `colcon build` is
# the whole workflow: there is no separate generate step to forget and no way to
# build against a stale interface. Only this file and package.xml are committed;
# msg/ and srv/ are generated (and gitignored).
#
# The same protofiles drive the WebRTC side (each producer package's setup.py) and
# the browser, so a field added in /proto reaches ROS2, the robot's producer code
# and the GUI from one edit.
cmake_minimum_required(VERSION 3.8)
project(my_interfaces)

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(Python3 REQUIRED COMPONENTS Interpreter)

# Where the protos live. Two situations, so this cannot be a fixed path:
#   - devcontainer / checkout: up out of robot/src/my_interfaces to example/proto
#   - inside the robot image: sources are copied elsewhere, so the Dockerfile
#     exports ROV_PROTO_DIR instead.
if(DEFINED ENV{ROV_PROTO_DIR})
  set(_rov_proto_default "$ENV{ROV_PROTO_DIR}")
else()
  set(_rov_proto_default "${CMAKE_CURRENT_SOURCE_DIR}/../../../proto")
endif()
set(ROV_PROTO_DIR "${_rov_proto_default}" CACHE PATH "Root of the example's proto directory")
get_filename_component(ROV_PROTO_DIR "${ROV_PROTO_DIR}" ABSOLUTE)

if(NOT IS_DIRECTORY "${ROV_PROTO_DIR}")
  message(FATAL_ERROR
    "my_interfaces: proto directory not found at ${ROV_PROTO_DIR}. "
    "Set -DROV_PROTO_DIR=<path> or the ROV_PROTO_DIR environment variable.")
endif()

# Every proto in the tree, both producer processes' included: one interface
# package for the workspace, so the ROS2 type names stay in one namespace. Pass
# --include to narrow it when some proto package has no ROS2 consumer at all.
message(STATUS "my_interfaces: generating msg/ and srv/ from ${ROV_PROTO_DIR}")
execute_process(
  COMMAND "${Python3_EXECUTABLE}" -m proto4webrtc_codegen.ros2
          --proto "${ROV_PROTO_DIR}"
          --out "${CMAKE_CURRENT_SOURCE_DIR}"
  RESULT_VARIABLE _gen_result
)
if(NOT _gen_result EQUAL 0)
  # Deliberately fatal. Continuing would build whatever msg/ and srv/ happened
  # to be left over from a previous run, which is the one failure mode running
  # the generator from the build exists to rule out.
  message(FATAL_ERROR "my_interfaces: proto4webrtc_codegen.ros2 failed (exit ${_gen_result})")
endif()

# Re-run configure -- and therefore the generator -- when a .proto changes.
# Without this, editing a proto and rebuilding silently keeps the old
# interfaces, because CMake sees no reason to reconfigure.
file(GLOB_RECURSE _rov_protos CONFIGURE_DEPENDS "${ROV_PROTO_DIR}/*.proto")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${_rov_protos})

file(GLOB _interface_files RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}" msg/*.msg srv/*.srv)
list(SORT _interface_files)

rosidl_generate_interfaces(${PROJECT_NAME}
  ${_interface_files}
)

ament_export_dependencies(rosidl_default_runtime)
ament_package()
