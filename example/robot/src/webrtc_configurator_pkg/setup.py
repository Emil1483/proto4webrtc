from pathlib import Path

from setuptools import find_packages, setup

from proto4webrtc_codegen import generate

package_name = 'webrtc_configurator_pkg'

# This package generates its own bundle, from only the protos its node needs:
#   * include: rov_config alone -- rov/streams + rov/rpc belong to
#     webrtc_streamer_pkg. A package pulling in protos it doesn't use would
#     just be extra generated code to build and rebuild.
#   * gen_package: the wrapper package gets its own name; two regular packages
#     both named proto4webrtc_gen would shadow each other on the sys.path
#     colcon shares across the workspace. Same reason the proto package is
#     rov_config, not rov.config.
#
# Splitting labels between PROCESSES needs neither of these -- that is
# Proto4WebrtcProducer(streams=[...]), see webrtc_streamer_pkg's three nodes.
# Here the split is per package because the protos differ too.
_here = Path(__file__).resolve().parent
generate(
    proto_dirs=[_here.parents[2] / 'proto'],
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
