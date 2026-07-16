#include <rclcpp/rclcpp.hpp>
#include <my_interfaces/msg/greeting.hpp>

class ListenerNode : public rclcpp::Node
{
public:
  ListenerNode() : Node("cpp_listener_node")
  {
    subscription_ = create_subscription<my_interfaces::msg::Greeting>(
      "greetings", 10,
      [this](const my_interfaces::msg::Greeting & msg) {
        RCLCPP_INFO(get_logger(), "Received from \"%s\" (#%d): %s",
          msg.sender.c_str(), msg.count, msg.message.c_str());
      });
    RCLCPP_INFO(get_logger(), "CppListenerNode started, subscribing to /greetings");
  }

private:
  rclcpp::Subscription<my_interfaces::msg::Greeting>::SharedPtr subscription_;
};

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<ListenerNode>());
  rclcpp::shutdown();
  return 0;
}
