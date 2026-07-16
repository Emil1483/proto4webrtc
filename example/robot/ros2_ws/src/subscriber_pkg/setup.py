from setuptools import find_packages, setup

package_name = 'subscriber_pkg'

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
    maintainer_email='user@example.com',
    description='A node that subscribes to Greeting messages',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'listener_node = subscriber_pkg.listener_node:main',
        ],
    },
)
