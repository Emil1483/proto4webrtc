from setuptools import find_packages, setup

package_name = 'camera_pkg'

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
    description='Publishes a synthetic animated video stream as sensor_msgs/Image',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'synthetic_camera_node = camera_pkg.synthetic_camera_node:main',
        ],
    },
)
