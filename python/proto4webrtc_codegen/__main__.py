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
    args = parser.parse_args()

    for path in generate(args.proto, args.out):
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
