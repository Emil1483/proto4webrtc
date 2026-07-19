FROM ros:humble

# Install dev tools
RUN apt-get update && apt-get install -y \
    python3-colcon-common-extensions \
    python3-rosdep \
    python3-pip \
    python-is-python3 \
    python3.10-venv \
    ros-humble-rclpy \
    ros-humble-rqt-graph \
    ros-humble-foxglove-bridge \
    curl ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/* \
    && pip install poetry

# Install Node.js 22 LTS + npm (for the Next.js server in /repo_root/server)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    # buf CLI for `buf dep update` / `buf generate` at the repo root (buf.yaml
    # lives there, not under server/, so the npm-local server/node_modules/.bin/buf
    # devDependency isn't on PATH for root-level commands).
    && npm install -g @bufbuild/buf

ENV POETRY_VIRTUALENVS_IN_PROJECT=true
ENV POETRY_VIRTUALENVS_OPTIONS_SYSTEM_SITE_PACKAGES=true

# Non-root user matching the host user, so files created in the bind mount
# aren't root-owned on the host. VS Code remaps the UID/GID to the local
# user's on container create (updateRemoteUserUID, on by default).
ARG USERNAME=dev
RUN useradd -m -s /bin/bash -u 1000 $USERNAME \
    && apt-get update && apt-get install -y sudo \
    && rm -rf /var/lib/apt/lists/* \
    && echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Source ROS2 (and the single example/.env, if present) on every bash session
# (root and dev). The .env is guarded so a missing file leaves the app to show
# its own clear "auth not configured" error instead of breaking the shell.
RUN for rc in /root/.bashrc /home/$USERNAME/.bashrc; do \
    echo "source /opt/ros/humble/setup.bash" >> $rc; \
    echo "source /repo_root/example/robot/install/setup.bash 2>/dev/null || true" >> $rc; \
    echo "export PYTHONPATH=\$PYTHONPATH:/repo_root/example/robot/.venv/lib/python3.10/site-packages" >> $rc; \
    echo "set -a; [ -f /repo_root/example/.env ] && . /repo_root/example/.env; set +a" >> $rc; \
    done
