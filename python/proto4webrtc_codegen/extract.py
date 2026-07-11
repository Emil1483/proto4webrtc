"""Extract stream declarations from a compiled FileDescriptorSet.

The proto4webrtc options are extensions of google.protobuf.MessageOptions.
descriptor_pb2 doesn't know them, so protoc parks them in the options'
unknown fields. We rebuild the options message with a DescriptorPool that
contains proto4webrtc/options.proto (it's in the set — protoc ran with
--include_imports) and re-parse, which surfaces the extensions.
"""

from dataclasses import dataclass

from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

from proto4webrtc_codegen.naming import to_snake_case

DATA_STREAM_EXT = "proto4webrtc.data_stream"
MEDIA_STREAM_EXT = "proto4webrtc.media_stream"


@dataclass
class StreamSpec:
    proto_file: str  # e.g. "example/streams.proto"
    package: str  # e.g. "example"
    message: str  # e.g. "Telemetry"

    @property
    def full_name(self) -> str:
        return f"{self.package}.{self.message}" if self.package else self.message


@dataclass
class DataStreamSpec(StreamSpec):
    label: str
    delivery: str  # proto4webrtc.Delivery value name, e.g. "RELIABLE_ORDERED"
    backpressure: str  # proto4webrtc.Backpressure value name
    max_buffered_factor: int


@dataclass
class MediaStreamSpec(StreamSpec):
    label: str
    kind: str  # "video" | "audio"
    video_codec: str  # proto4webrtc.VideoCodec value name


class ExtractError(Exception):
    pass


def _enum_name(pool, enum_type: str, number: int) -> str:
    return pool.FindEnumTypeByName(enum_type).values_by_number[number].name


def extract_streams(
    fdset: descriptor_pb2.FileDescriptorSet,
    files_to_generate: set[str],
) -> tuple[list[DataStreamSpec], list[MediaStreamSpec]]:
    """Return (data streams, media streams) declared in files_to_generate."""
    pool = descriptor_pool.DescriptorPool()
    for fdp in fdset.file:  # --include_imports output is dependency-ordered
        pool.Add(fdp)

    try:
        data_ext = pool.FindExtensionByName(DATA_STREAM_EXT)
        media_ext = pool.FindExtensionByName(MEDIA_STREAM_EXT)
    except KeyError as exc:
        raise ExtractError(
            "proto4webrtc/options.proto missing from descriptor set "
            "(compile with --include_imports)"
        ) from exc

    options_cls = message_factory.GetMessageClass(
        pool.FindMessageTypeByName("google.protobuf.MessageOptions")
    )

    data_streams: list[DataStreamSpec] = []
    media_streams: list[MediaStreamSpec] = []

    for fdp in fdset.file:
        if fdp.name not in files_to_generate:
            continue
        for msg in fdp.message_type:
            # Re-parse options with the extension-aware pool.
            opts = options_cls()
            opts.ParseFromString(msg.options.SerializeToString())

            if opts.HasExtension(data_ext):
                o = opts.Extensions[data_ext]
                if not o.label:
                    raise ExtractError(
                        f"{fdp.name}: {msg.name} data_stream needs a label"
                    )
                data_streams.append(
                    DataStreamSpec(
                        proto_file=fdp.name,
                        package=fdp.package,
                        message=msg.name,
                        label=o.label,
                        delivery=_enum_name(
                            pool, "proto4webrtc.Delivery", o.delivery
                        ),
                        backpressure=_enum_name(
                            pool, "proto4webrtc.Backpressure", o.backpressure
                        ),
                        max_buffered_factor=o.max_buffered_factor or 2,
                    )
                )

            if opts.HasExtension(media_ext):
                o = opts.Extensions[media_ext]
                if not o.label:
                    raise ExtractError(
                        f"{fdp.name}: {msg.name} media_stream needs a label"
                    )
                if msg.field:
                    raise ExtractError(
                        f"{fdp.name}: {msg.name} is a media_stream and must have "
                        "no fields (frames travel as RTP, not protobuf)"
                    )
                kind = _enum_name(pool, "proto4webrtc.MediaKind", o.kind)
                if kind == "MEDIA_KIND_UNSPECIFIED":
                    raise ExtractError(
                        f"{fdp.name}: {msg.name} media_stream needs kind"
                    )
                media_streams.append(
                    MediaStreamSpec(
                        proto_file=fdp.name,
                        package=fdp.package,
                        message=msg.name,
                        label=o.label,
                        kind=kind.lower(),
                        video_codec=_enum_name(
                            pool, "proto4webrtc.VideoCodec", o.video_codec
                        ),
                    )
                )

    labels = [s.label for s in data_streams + media_streams]
    dupes = {l for l in labels if labels.count(l) > 1}
    if dupes:
        raise ExtractError(f"duplicate stream labels: {sorted(dupes)}")

    attrs = [to_snake_case(s.message) for s in data_streams + media_streams]
    attr_dupes = {a for a in attrs if attrs.count(a) > 1}
    if attr_dupes:
        raise ExtractError(
            f"duplicate Proto4WebrtcProducer attribute names: {sorted(attr_dupes)} "
            "(derived from message name; rename one of the colliding messages)"
        )

    return data_streams, media_streams
