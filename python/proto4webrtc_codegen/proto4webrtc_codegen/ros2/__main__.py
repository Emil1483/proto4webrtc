"""CLI: python -m proto4webrtc_codegen.ros2 --proto <dir> --out <pkg dir>

Invoked from an ament interface package's CMakeLists at CMake configure time,
i.e. by every `colcon build`. Deliberately not a console script: CMake's
execute_process runs `${Python3_EXECUTABLE} -m proto4webrtc_codegen.ros2`, so
there is no venv/PATH question to get wrong.
"""

import argparse
import sys

from proto4webrtc_codegen.ros2.generator import Ros2GenError, generate_interfaces


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m proto4webrtc_codegen.ros2",
        description="Generate ROS2 .msg/.srv interfaces from protofiles",
    )
    parser.add_argument(
        "--proto",
        required=True,
        action="append",
        metavar="DIR",
        help="protofile root (repeatable; proto4webrtc/options.proto is bundled "
        "and added to the include path automatically)",
    )
    parser.add_argument(
        "--out",
        required=True,
        metavar="DIR",
        help="the ament interface package's directory; msg/ and srv/ inside it "
        "are generated (and stale generated files removed)",
    )
    parser.add_argument(
        "--include",
        action="append",
        metavar="GLOB",
        help="only turn matching files into interfaces (glob relative to a root, "
        "repeatable, e.g. telemetry/*.proto). Imports still resolve — use this "
        "to keep proto packages no ROS node consumes out of the package",
    )
    parser.add_argument(
        "--no-services",
        action="store_true",
        help="skip .srv generation; emit messages only",
    )
    parser.add_argument(
        "--srv-prefix-service",
        action="store_true",
        help="name srv files <Service><Method>.srv instead of <Method>.srv, for "
        "when two services share a method name",
    )
    args = parser.parse_args(argv)

    try:
        paths = generate_interfaces(
            args.proto,
            args.out,
            include=args.include,
            services=not args.no_services,
            srv_prefix_service=args.srv_prefix_service,
        )
    except Ros2GenError as err:
        print(f"proto4webrtc_codegen.ros2: {err}", file=sys.stderr)
        return 1

    print(
        f"proto4webrtc_codegen.ros2: wrote {len(paths)} interfaces to "
        f"{args.out}: {', '.join(paths)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
