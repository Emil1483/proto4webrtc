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
RPC_SERVICE_EXT = "proto4webrtc.rpc_service"
PROTECTED_EXT = "proto4webrtc.protected"


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
    protected: bool  # admin-only: SFU denies guests consumeData


@dataclass
class MediaStreamSpec(StreamSpec):
    label: str
    kind: str  # "video" | "audio"
    video_codec: str  # proto4webrtc.VideoCodec value name
    protected: bool  # admin-only: SFU denies guests consume


@dataclass
class RpcMethodSpec:
    name: str  # method name as declared, e.g. "SetSpeed" — the wire id
    protected: bool  # admin-only: robot rejects guest callers
    input_full_name: str  # e.g. "example.SetSpeedRequest" (no leading dot)
    input_proto_file: str
    output_full_name: str
    output_proto_file: str

    @property
    def input_message(self) -> str:
        return self.input_full_name.rsplit(".", 1)[-1]

    @property
    def output_message(self) -> str:
        return self.output_full_name.rsplit(".", 1)[-1]


@dataclass
class RpcServiceSpec:
    proto_file: str
    package: str
    service: str  # e.g. "RobotControl"
    label: str  # channel base: "<label>/requests", "<label>/responses"
    methods: list[RpcMethodSpec]

    @property
    def full_name(self) -> str:
        return f"{self.package}.{self.service}" if self.package else self.service


class ExtractError(Exception):
    pass


def _enum_name(pool, enum_type: str, number: int) -> str:
    return pool.FindEnumTypeByName(enum_type).values_by_number[number].name


def extract_streams(
    fdset: descriptor_pb2.FileDescriptorSet,
    files_to_generate: set[str],
) -> tuple[list[DataStreamSpec], list[MediaStreamSpec], list[RpcServiceSpec]]:
    """Return (data streams, media streams, rpc services) declared in files_to_generate."""
    pool = descriptor_pool.DescriptorPool()
    for fdp in fdset.file:  # --include_imports output is dependency-ordered
        pool.Add(fdp)

    try:
        data_ext = pool.FindExtensionByName(DATA_STREAM_EXT)
        media_ext = pool.FindExtensionByName(MEDIA_STREAM_EXT)
        rpc_ext = pool.FindExtensionByName(RPC_SERVICE_EXT)
    except KeyError as exc:
        raise ExtractError(
            "proto4webrtc/options.proto missing from descriptor set "
            "(compile with --include_imports)"
        ) from exc
    try:
        protected_ext = pool.FindExtensionByName(PROTECTED_EXT)
    except KeyError:
        protected_ext = None  # pre-auth options.proto in the compiled set

    options_cls = message_factory.GetMessageClass(
        pool.FindMessageTypeByName("google.protobuf.MessageOptions")
    )
    service_options_cls = message_factory.GetMessageClass(
        pool.FindMessageTypeByName("google.protobuf.ServiceOptions")
    )
    method_options_cls = message_factory.GetMessageClass(
        pool.FindMessageTypeByName("google.protobuf.MethodOptions")
    )

    data_streams: list[DataStreamSpec] = []
    media_streams: list[MediaStreamSpec] = []
    rpc_services: list[RpcServiceSpec] = []

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
                        protected=o.protected,
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
                        protected=o.protected,
                    )
                )

    for fdp in fdset.file:
        if fdp.name not in files_to_generate:
            continue
        for svc in fdp.service:
            opts = service_options_cls()
            opts.ParseFromString(svc.options.SerializeToString())
            if not opts.HasExtension(rpc_ext):
                continue  # plain (e.g. grpc-only) service; not ours
            o = opts.Extensions[rpc_ext]
            if not o.label:
                raise ExtractError(
                    f"{fdp.name}: {svc.name} rpc_service needs a label"
                )
            methods: list[RpcMethodSpec] = []
            for m in svc.method:
                if m.client_streaming or m.server_streaming:
                    raise ExtractError(
                        f"{fdp.name}: {svc.name}.{m.name} is streaming; "
                        "rpc_service supports unary methods only"
                    )
                input_full = m.input_type.lstrip(".")
                output_full = m.output_type.lstrip(".")
                method_protected = False
                if protected_ext is not None:
                    mopts = method_options_cls()
                    mopts.ParseFromString(m.options.SerializeToString())
                    method_protected = mopts.Extensions[protected_ext]
                methods.append(
                    RpcMethodSpec(
                        name=m.name,
                        protected=method_protected,
                        input_full_name=input_full,
                        input_proto_file=pool.FindMessageTypeByName(
                            input_full
                        ).file.name,
                        output_full_name=output_full,
                        output_proto_file=pool.FindMessageTypeByName(
                            output_full
                        ).file.name,
                    )
                )
            if not methods:
                raise ExtractError(
                    f"{fdp.name}: {svc.name} rpc_service declares no methods"
                )
            method_names = [m.name for m in methods]
            method_dupes = {n for n in method_names if method_names.count(n) > 1}
            if method_dupes:
                raise ExtractError(
                    f"{fdp.name}: {svc.name} duplicate method names: "
                    f"{sorted(method_dupes)}"
                )
            rpc_services.append(
                RpcServiceSpec(
                    proto_file=fdp.name,
                    package=fdp.package,
                    service=svc.name,
                    label=o.label,
                    methods=methods,
                )
            )

    # rpc services occupy "<label>/requests" and "<label>/responses"; keep the
    # whole namespace collision-free by checking base labels together.
    labels = [s.label for s in data_streams + media_streams + rpc_services]
    dupes = {l for l in labels if labels.count(l) > 1}
    if dupes:
        raise ExtractError(f"duplicate stream labels: {sorted(dupes)}")

    attrs = [to_snake_case(s.message) for s in data_streams + media_streams] + [
        to_snake_case(s.service) for s in rpc_services
    ]
    attr_dupes = {a for a in attrs if attrs.count(a) > 1}
    if attr_dupes:
        raise ExtractError(
            f"duplicate Proto4WebrtcProducer attribute names: {sorted(attr_dupes)} "
            "(derived from message/service name; rename one of the colliding ones)"
        )

    return data_streams, media_streams, rpc_services
