"""CLI: python -m proto4webrtc_codegen --proto <dir> [--proto <dir>] --out <dir>"""

import argparse

from proto4webrtc_codegen.driver import generate


def main():
    parser = argparse.ArgumentParser(
        description="Generate mediasoup producer code from proto4webrtc protofiles"
    )
    parser.add_argument(
        "--proto",
        required=True,
        action="append",
        help="protofile root (repeatable; proto4webrtc/options.proto is "
        "bundled and added automatically if absent)",
    )
    parser.add_argument("--out", required=True, help="output directory")
    parser.add_argument(
        "--include",
        action="append",
        help="glob relative to the roots (repeatable, e.g. rov/streams/*.proto); "
        "compile only matching files — for producer processes that own a "
        "subset of the streams",
    )
    parser.add_argument(
        "--gen-package",
        default="proto4webrtc_gen",
        help="name of the generated wrapper package (default proto4webrtc_gen); "
        "give each producer package its own name when several land on one "
        "sys.path",
    )
    args = parser.parse_args()

    for path in generate(
        args.proto, args.out, include=args.include, gen_package=args.gen_package
    ):
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
