from pathlib import Path

from setuptools import find_packages, setup

from proto4webrtc_codegen import generate

package_name = 'webrtc_configurator_pkg'

# Second producer process in the same workspace/container as
# webrtc_streamer_pkg. Two things keep the packages from colliding on the
# shared sys.path colcon builds:
#   * include: this process generates (and therefore produces) ONLY the
#     rov_config streams — the streamer owns rov/streams + rov/rpc.
#   * gen_package: the wrapper package gets its own name; two regular
#     packages both named proto4webrtc_gen would shadow each other. Same
#     reason the proto package is rov_config, not rov.config.
_here = Path(__file__).resolve().parent
generate(
    proto_dirs=[_here.parents[3] / 'proto'],
    out_dir=_here,
    include=['rov_config/*.proto'],
    gen_package='rov_config_gen',
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
    description='Second WebRTC producer: mission_status stream + Configurator rpc',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'webrtc_configurator_node = webrtc_configurator_pkg.webrtc_configurator_node:main',
        ],
    },
)
