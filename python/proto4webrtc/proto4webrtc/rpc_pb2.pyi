from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class RpcRequest(_message.Message):
    __slots__ = ("client_id", "id", "method", "payload")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    METHOD_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    id: int
    method: str
    payload: bytes
    def __init__(self, client_id: _Optional[str] = ..., id: _Optional[int] = ..., method: _Optional[str] = ..., payload: _Optional[bytes] = ...) -> None: ...

class RpcResponse(_message.Message):
    __slots__ = ("client_id", "id", "payload", "error")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    id: int
    payload: bytes
    error: str
    def __init__(self, client_id: _Optional[str] = ..., id: _Optional[int] = ..., payload: _Optional[bytes] = ..., error: _Optional[str] = ...) -> None: ...
