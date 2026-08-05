from pathlib import Path

from setuptools import find_packages, setup

from proto4webrtc_codegen import generate

package_name = 'webrtc_streamer_pkg'

# Regenerate the stream code (pb2 messages + mediasoup producer wrappers)
# from the repo's protofiles on every build. proto4webrtc/options.proto is
# bundled with the pip package and added to the include path automatically.
# The generated top-level packages (rov, proto4webrtc_gen) land next to
# webrtc_streamer_pkg/ and are picked up by find_packages() below.
#
# include: only the protos this package's nodes actually need -- rov/streams
# (telemetry, camera, pointcloud) and rov/rpc (RovControl, Greeter). rov_config
# belongs to webrtc_configurator_pkg, which generates its own bundle. Keeping
# the include tight means an unrelated proto can't drag encoder code, ROS
# dependencies or rebuild churn into this package.
#
# The three nodes here SHARE this one bundle: each names the labels it owns
# with Proto4WebrtcProducer(streams=[...]), so they are separate processes
# (camera dying leaves telemetry publishing) without being separate packages.
_here = Path(__file__).resolve().parent
generate(
    proto_dirs=[_here.parents[2] / 'proto'],
    out_dir=_here,
    include=['rov/streams/*.proto', 'rov/rpc/*.proto'],
)

setup(
    name=package_name,
    version='0.0.1',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='user',
    maintainer_email='emil@djupvik.dev',
    description='Bridges ROS2 topics to the server over WebRTC (aiortc peers): camera, telemetry and rpc nodes',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'camera_node = webrtc_streamer_pkg.camera_node:main',
            'telemetry_node = webrtc_streamer_pkg.telemetry_node:main',
            'rpc_node = webrtc_streamer_pkg.rpc_node:main',
        ],
    },
)
