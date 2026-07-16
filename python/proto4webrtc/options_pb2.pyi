from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Delivery(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DELIVERY_UNSPECIFIED: _ClassVar[Delivery]
    RELIABLE_ORDERED: _ClassVar[Delivery]
    UNRELIABLE: _ClassVar[Delivery]

class Backpressure(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    BACKPRESSURE_UNSPECIFIED: _ClassVar[Backpressure]
    BUFFER_ALL: _ClassVar[Backpressure]
    DROP_IF_BUFFERED: _ClassVar[Backpressure]

class MediaKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MEDIA_KIND_UNSPECIFIED: _ClassVar[MediaKind]
    VIDEO: _ClassVar[MediaKind]
    AUDIO: _ClassVar[MediaKind]

class VideoCodec(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VIDEO_CODEC_UNSPECIFIED: _ClassVar[VideoCodec]
    VP8: _ClassVar[VideoCodec]
    VP9: _ClassVar[VideoCodec]
    H264: _ClassVar[VideoCodec]
DELIVERY_UNSPECIFIED: Delivery
RELIABLE_ORDERED: Delivery
UNRELIABLE: Delivery
BACKPRESSURE_UNSPECIFIED: Backpressure
BUFFER_ALL: Backpressure
DROP_IF_BUFFERED: Backpressure
MEDIA_KIND_UNSPECIFIED: MediaKind
VIDEO: MediaKind
AUDIO: MediaKind
VIDEO_CODEC_UNSPECIFIED: VideoCodec
VP8: VideoCodec
VP9: VideoCodec
H264: VideoCodec
DATA_STREAM_FIELD_NUMBER: _ClassVar[int]
data_stream: _descriptor.FieldDescriptor
MEDIA_STREAM_FIELD_NUMBER: _ClassVar[int]
media_stream: _descriptor.FieldDescriptor
RPC_SERVICE_FIELD_NUMBER: _ClassVar[int]
rpc_service: _descriptor.FieldDescriptor

class DataStreamOptions(_message.Message):
    __slots__ = ("label", "delivery", "backpressure", "max_buffered_factor")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    DELIVERY_FIELD_NUMBER: _ClassVar[int]
    BACKPRESSURE_FIELD_NUMBER: _ClassVar[int]
    MAX_BUFFERED_FACTOR_FIELD_NUMBER: _ClassVar[int]
    label: str
    delivery: Delivery
    backpressure: Backpressure
    max_buffered_factor: int
    def __init__(self, label: _Optional[str] = ..., delivery: _Optional[_Union[Delivery, str]] = ..., backpressure: _Optional[_Union[Backpressure, str]] = ..., max_buffered_factor: _Optional[int] = ...) -> None: ...

class MediaStreamOptions(_message.Message):
    __slots__ = ("label", "kind", "video_codec")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    VIDEO_CODEC_FIELD_NUMBER: _ClassVar[int]
    label: str
    kind: MediaKind
    video_codec: VideoCodec
    def __init__(self, label: _Optional[str] = ..., kind: _Optional[_Union[MediaKind, str]] = ..., video_codec: _Optional[_Union[VideoCodec, str]] = ...) -> None: ...

class RpcServiceOptions(_message.Message):
    __slots__ = ("label",)
    LABEL_FIELD_NUMBER: _ClassVar[int]
    label: str
    def __init__(self, label: _Optional[str] = ...) -> None: ...
