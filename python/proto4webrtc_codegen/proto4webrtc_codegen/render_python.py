"""Render the Python producer module (pymediasoup side).

Logic lives here (import paths, delivery/backpressure decisions, aggregate
client wiring); layout lives in templates/producers.py.j2. Per-stream classes
are thin subclasses of the proto4webrtc runtime base classes: data producers
override _produce_kwargs()/_check_backpressure(), media producers just carry
LABEL/KIND. One extra aggregate Proto4WebrtcProducer class binds every stream
to a snake_case(message name) attribute.
"""

from jinja2 import Environment, PackageLoader

from proto4webrtc_codegen.extract import (
    DataStreamSpec,
    MediaStreamSpec,
    RpcServiceSpec,
)
from proto4webrtc_codegen.naming import to_snake_case

_env = Environment(
    loader=PackageLoader("proto4webrtc_codegen"),
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
)

_CLOCK_RATE_BY_KIND = {"video": 90000, "audio": 48000}


def _module(proto_file: str) -> str:
    return proto_file[: -len(".proto")].replace("/", ".") + "_pb2"


def _alias(proto_file: str) -> str:
    return "_" + _module(proto_file).replace(".", "_")


def _data_context(s: DataStreamSpec) -> dict:
    if s.delivery == "UNRELIABLE":
        produce_kwargs = '{"ordered": False, "maxRetransmits": 0}'
        delivery_doc = "unreliable (unordered, no retransmits)"
    else:  # RELIABLE_ORDERED, and the safe default for UNSPECIFIED
        produce_kwargs = "{}"
        delivery_doc = "reliable + ordered"

    drop = s.backpressure == "DROP_IF_BUFFERED"
    if drop:
        backpressure_doc = (
            f"newest wins: send() drops the message if the channel still "
            f"buffers more than {s.max_buffered_factor}x its size"
        )
    else:
        backpressure_doc = "buffer all: every send() is handed to the channel"

    return {
        "attr": to_snake_case(s.message),
        "class_name": f"{s.message}Producer",
        "message": s.message,
        "full_name": s.full_name,
        "label": s.label,
        "alias": _alias(s.proto_file),
        "produce_kwargs": produce_kwargs,
        "delivery_doc": delivery_doc,
        "backpressure_doc": backpressure_doc,
        "drop": drop,
        "max_buffered_factor": s.max_buffered_factor,
        "protected": s.protected,
    }


def _media_context(s: MediaStreamSpec) -> dict:
    codec_doc = (
        "" if s.video_codec == "VIDEO_CODEC_UNSPECIFIED" else f", {s.video_codec}"
    )
    return {
        "attr": to_snake_case(s.message),
        "class_name": f"{s.message}Producer",
        "track_attr": f"_{to_snake_case(s.message)}_track",
        "message": s.message,
        "label": s.label,
        "kind": s.kind,
        "clock_rate": _CLOCK_RATE_BY_KIND.get(s.kind, 90000),
        "codec_doc": codec_doc,
        "protected": s.protected,
    }


def _rpc_context(s: RpcServiceSpec) -> dict:
    methods = [
        {
            "attr": to_snake_case(m.name),
            "wire_name": m.name,
            "request": m.input_message,
            "request_ref": f"{_alias(m.input_proto_file)}.{m.input_message}",
            "response": m.output_message,
            "response_ref": f"{_alias(m.output_proto_file)}.{m.output_message}",
            "protected": m.protected,
        }
        for m in s.methods
    ]
    return {
        "attr": to_snake_case(s.service),
        "class_name": f"{s.service}Base",
        "service": s.service,
        "full_name": s.full_name,
        "label": s.label,
        "methods": methods,
    }


def render_producers(
    data_streams: list[DataStreamSpec],
    media_streams: list[MediaStreamSpec],
    rpc_services: list[RpcServiceSpec] | None = None,
) -> str:
    rpc_services = rpc_services or []
    import_files = {s.proto_file for s in data_streams} | {
        f
        for s in rpc_services
        for m in s.methods
        for f in (m.input_proto_file, m.output_proto_file)
    }
    imports = [
        {
            "package": ".".join(_module(f).split(".")[:-1]),
            "module": _module(f).split(".")[-1],
            "alias": _alias(f),
        }
        for f in sorted(import_files)
    ]
    data = [_data_context(s) for s in data_streams]
    media = [_media_context(s) for s in media_streams]
    rpc = [_rpc_context(s) for s in rpc_services]

    # Re-exported message classes: data stream payloads + rpc method types.
    message_exports = {(d["message"], f"{d['alias']}.{d['message']}") for d in data}
    for r in rpc:
        for m in r["methods"]:
            message_exports.add((m["request"], m["request_ref"]))
            message_exports.add((m["response"], m["response_ref"]))
    exported_names = {n for n, _ in message_exports}
    ambiguous = {
        n for n in exported_names
        if len({ref for name, ref in message_exports if name == n}) > 1
    }
    if ambiguous:
        raise ValueError(
            f"colliding message names across proto files: {sorted(ambiguous)}"
        )

    all_names = sorted(
        exported_names
        | {d["class_name"] for d in data}
        | {m["class_name"] for m in media}
        | {r["class_name"] for r in rpc}
        | {"Proto4WebrtcProducer"}
    )
    return _env.get_template("producers.py.j2").render(
        imports=imports,
        data=data,
        media=media,
        rpc=rpc,
        messages=sorted(message_exports),
        all_names=repr(all_names),
    )
