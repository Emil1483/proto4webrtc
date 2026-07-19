#!/bin/bash
set -e

source /opt/ros/humble/setup.bash
source /robot/install/setup.bash

exec "$@"
