"""End-to-end generation: protofiles -> pb2 modules + producer wrappers.

Runs grpc_tools.protoc (bundled protoc, no system install needed) with
--python_out for message classes and --descriptor_set_out for the stream
metadata, then renders proto4webrtc_gen/producers.py.

The package bundles proto4webrtc/options.proto: if none of the given roots
contains it (the usual case — proto authors resolve the import from the Buf
Schema Registry, which never materializes the file locally), the bundled
copy is added to the include path and compiled automatically.

Generated packages land in out_dir with __init__.py files so setuptools'
find_packages() picks them up — call generate() from setup.py to regenerate
on every build.
"""

import tempfile
from importlib import resources
from pathlib import Path

from google.protobuf import descriptor_pb2

from proto4webrtc_codegen.extract import extract_streams
from proto4webrtc_codegen.plugin import INIT_CONTENT
from proto4webrtc_codegen.render_python import render_producers

GEN_PACKAGE = "proto4webrtc_gen"
OPTIONS_PROTO = "proto4webrtc/options.proto"


def _well_known_include() -> str:
    """grpc_tools ships google/protobuf/*.proto (descriptor.proto etc.)."""
    return str(resources.files("grpc_tools") / "_proto")


def bundled_options_include() -> str:
    """Include root containing the bundled proto4webrtc/options.proto."""
    return str(resources.files("proto4webrtc_codegen") / "proto")


def generate(proto_dirs, out_dir) -> list[Path]:
    """Compile every .proto under the given root(s) into out_dir.

    proto_dirs: one dir or a list of dirs; each is a protoc include root.
    Returns the extra files written beside protoc's own output.
    """
    from grpc_tools import protoc

    if isinstance(proto_dirs, (str, Path)):
        proto_dirs = [proto_dirs]
    proto_dirs = [Path(d).resolve() for d in proto_dirs]
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    proto_files = sorted(
        str(p.relative_to(d)) for d in proto_dirs for p in d.rglob("*.proto")
    )
    if not proto_files:
        raise FileNotFoundError(f"no .proto files under {proto_dirs}")
    if len(set(proto_files)) != len(proto_files):
        raise ValueError(f"duplicate proto paths across roots {proto_dirs}")

    include_dirs = [str(d) for d in proto_dirs]
    if OPTIONS_PROTO not in proto_files:
        include_dirs.append(bundled_options_include())
        proto_files.append(OPTIONS_PROTO)

    with tempfile.NamedTemporaryFile(suffix=".binpb") as tmp:
        args = [
            "protoc",
            *(f"-I{d}" for d in include_dirs),
            f"-I{_well_known_include()}",
            f"--python_out={out_dir}",
            f"--pyi_out={out_dir}",
            f"--descriptor_set_out={tmp.name}",
            "--include_imports",
            *proto_files,
        ]
        if protoc.main(args) != 0:
            raise RuntimeError(f"protoc failed: {' '.join(args)}")
        fdset = descriptor_pb2.FileDescriptorSet.FromString(
            Path(tmp.name).read_bytes()
        )

    written: list[Path] = []

    # __init__.py so the generated trees are regular, packageable packages.
    for proto_file in proto_files:
        d = out_dir
        for part in Path(proto_file).parent.parts:
            d = d / part
            init = d / "__init__.py"
            if not init.exists():
                init.write_text("")
                written.append(init)

    data_streams, media_streams = extract_streams(fdset, set(proto_files))

    gen_dir = out_dir / GEN_PACKAGE
    gen_dir.mkdir(exist_ok=True)
    (gen_dir / "__init__.py").write_text(INIT_CONTENT)
    producers = gen_dir / "producers.py"
    producers.write_text(render_producers(data_streams, media_streams))
    written += [gen_dir / "__init__.py", producers]

    return written
