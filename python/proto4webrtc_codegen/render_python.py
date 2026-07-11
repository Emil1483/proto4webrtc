"""Render the Python producer module (pymediasoup side).

Logic lives here (import paths, delivery/backpressure decisions, aggregate
client wiring); layout lives in templates/producers.py.j2. Per-stream classes
are thin subclasses of the proto4webrtc runtime base classes: data producers
override _produce_kwargs()/_check_backpressure(), media producers just carry
LABEL/KIND. One extra aggregate Proto4WebrtcProducer class binds every stream
to a snake_case(message name) attribute.
"""

from jinja2 import Environment, PackageLoader

from proto4webrtc_codegen.extract import DataStreamSpec, MediaStreamSpec
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
    }


def render_producers(
    data_streams: list[DataStreamSpec], media_streams: list[MediaStreamSpec]
) -> str:
    imports = [
        {
            "package": ".".join(_module(f).split(".")[:-1]),
            "module": _module(f).split(".")[-1],
            "alias": _alias(f),
        }
        for f in sorted({s.proto_file for s in data_streams})
    ]
    data = [_data_context(s) for s in data_streams]
    media = [_media_context(s) for s in media_streams]
    all_names = sorted(
        [s.message for s in data_streams]
        + [d["class_name"] for d in data]
        + [m["class_name"] for m in media]
        + ["Proto4WebrtcProducer"]
    )
    return _env.get_template("producers.py.j2").render(
        imports=imports,
        data=data,
        media=media,
        all_names=repr(all_names),
    )
