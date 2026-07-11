"""Render the Python producer module (pymediasoup side).

Logic lives here (import paths, delivery/backpressure decisions); layout
lives in templates/producers.py.j2. One wrapper class per stream: data
producers encode the pb2 message and apply the declared backpressure policy,
media producers wire up the track with appData.label.
"""

from jinja2 import Environment, PackageLoader

from proto4webrtc_codegen.extract import DataStreamSpec, MediaStreamSpec

_env = Environment(
    loader=PackageLoader("proto4webrtc_codegen"),
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
)


def _module(proto_file: str) -> str:
    return proto_file[: -len(".proto")].replace("/", ".") + "_pb2"


def _alias(proto_file: str) -> str:
    return "_" + _module(proto_file).replace(".", "_")


def _data_context(s: DataStreamSpec) -> dict:
    if s.delivery == "UNRELIABLE":
        produce_kwargs = "label=cls.LABEL, ordered=False, maxRetransmits=0"
        delivery_doc = "unreliable (unordered, no retransmits)"
    else:  # RELIABLE_ORDERED, and the safe default for UNSPECIFIED
        produce_kwargs = "label=cls.LABEL"
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
        "message": s.message,
        "label": s.label,
        "kind": s.kind,
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
    all_names = sorted(
        [s.message for s in data_streams]
        + [f"{s.message}Producer" for s in data_streams + media_streams]
    )
    return _env.get_template("producers.py.j2").render(
        imports=imports,
        data=[_data_context(s) for s in data_streams],
        media=[_media_context(s) for s in media_streams],
        all_names=repr(all_names),
    )
