# ROS2 Basic Example

A learning project demonstrating ROS2 publisher-subscriber communication with custom messages and node auto-respawn.

## What it does

- A **publisher** (`greeter_node`) publishes `Greeting` messages on the `/greetings` topic at 1 Hz
- A **subscriber** (`listener_node`) receives messages and intentionally crashes after 3 messages
- The **bringup** launch file starts both nodes and auto-respawns the subscriber when it crashes

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

## Getting started

### 1. Open in dev container

Open the project in VS Code and click **Reopen in Container** when prompted (or run `Dev Containers: Reopen in Container` from the command palette).

The container will automatically run:

```bash
rosdep update && rosdep install --from-paths ros2_ws/src --ignore-src -r -y
```

### 2. Build

```bash
# In ros2_ws
colcon build --symlink-install
```

### 3. Source the workspace

```bash
source install/setup.bash
```

### 4. Run

Launch all nodes at once:

```bash
ros2 launch robot_bringup all_nodes.launch.py
```

Or run nodes individually in separate terminals (each sourced):

```bash
# Terminal 1
ros2 run publisher_pkg greeter_node

# Terminal 2
ros2 run subscriber_pkg listener_node
```

## Packages

| Package | Type | Description |
|---------|------|-------------|
| `my_interfaces` | CMake | Custom `Greeting.msg` message definition |
| `publisher_pkg` | Python | Publishes greeting messages at 1 Hz |
| `subscriber_pkg` | Python | Subscribes to greetings, crashes after 3 messages |
| `robot_bringup` | Python | Launch file that starts everything with auto-respawn |

## Custom message

See [`ros2_ws/src/my_interfaces/msg/Greeting.msg`](ros2_ws/src/my_interfaces/msg/Greeting.msg).

## Cleaning the workspace

There is no built-in `colcon clean` command, but you can install the `colcon-clean` plugin:

```bash
pip install colcon-clean
colcon clean workspace
```

Or just remove the directories manually:

```bash
rm -rf build install log
```

## Inspecting topics

```bash
ros2 topic list
ros2 topic echo /greetings
```

## Visualizing nodes and topics

### rqt_graph

Shows a graph of all running nodes and the topics connecting them. Requires X11 — on the **host** run:

```bash
xhost +local:docker
```

Then inside the container:

```bash
ros2 run rqt_graph rqt_graph
```

### Foxglove Studio

Useful for visualizing topic data. Start the bridge inside the container:

```bash
ros2 run foxglove_bridge foxglove_bridge
```

Then open [studio.foxglove.dev](https://studio.foxglove.dev) in your browser, choose **Open connection**, and connect to `ws://localhost:8765`.
