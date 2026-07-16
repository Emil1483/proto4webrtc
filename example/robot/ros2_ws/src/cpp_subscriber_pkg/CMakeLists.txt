cmake_minimum_required(VERSION 3.8)
project(cpp_subscriber_pkg)

set(CMAKE_CXX_STANDARD 20)

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(my_interfaces REQUIRED)

add_executable(listener_node src/listener_node.cpp)
ament_target_dependencies(listener_node rclcpp my_interfaces)

install(TARGETS listener_node
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
