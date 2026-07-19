from pathlib import Path

from setuptools import find_packages, setup

from proto4webrtc_codegen import generate

package_name = 'webrtc_streamer_pkg'

# Regenerate the stream code (pb2 messages + mediasoup producer wrappers)
# from the repo's protofiles on every build. proto4webrtc/options.proto is
# bundled with the pip package and added to the include path automatically.
# The generated top-level packages (rov, proto4webrtc, proto4webrtc_gen) land
# next to webrtc_streamer_pkg/ and are picked up by find_packages() below.
#
# include: this process owns only the telemetry/media streams and the
# RovControl rpc — rov_config belongs to webrtc_configurator_pkg. The
# producer runtime produces every stream in its generated code, so
# generating from the full proto root here would duplicate the
# configurator's streams.
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
    description='Bridges ROS2 topics to the server over WebRTC (aiortc peer)',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'webrtc_streamer_node = webrtc_streamer_pkg.webrtc_streamer_node:main',
        ],
    },
)
