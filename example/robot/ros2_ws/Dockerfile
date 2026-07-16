FROM ros:humble

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3-colcon-common-extensions \
    python3-rosdep \
    python3-pip \
    ros-humble-rclpy \
    && rm -rf /var/lib/apt/lists/* \
    && pip install poetry

ENV POETRY_VIRTUALENVS_IN_PROJECT=true
ENV POETRY_VIRTUALENVS_OPTIONS_SYSTEM_SITE_PACKAGES=true

WORKDIR /ros2_ws

# Install Python dependencies
COPY pyproject.toml poetry.lock* ./
RUN poetry install --no-root

# Install ROS dependencies
COPY src/ src/
RUN . /opt/ros/humble/setup.sh && \
    rosdep update && \
    rosdep install --from-paths src --ignore-src -r -y

# Build the workspace
RUN . /opt/ros/humble/setup.sh && \
    colcon build --symlink-install

ENV PYTHONPATH=/ros2_ws/.venv/lib/python3.10/site-packages

# Source ROS2 and workspace on every bash session
RUN echo "source /opt/ros/humble/setup.bash" >> /root/.bashrc && \
    echo "source /ros2_ws/install/setup.bash" >> /root/.bashrc

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["ros2", "launch", "robot_bringup", "all_nodes.launch.py"]
