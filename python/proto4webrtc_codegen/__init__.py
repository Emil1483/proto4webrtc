"""proto4webrtc-codegen: mediasoup stream code generation from protofiles.

Protofiles annotate messages with (proto4webrtc.data_stream) or
(proto4webrtc.media_stream) options (see proto4webrtc/options.proto). This
package compiles them with grpc_tools.protoc and renders typed mediasoup
producer wrappers for pymediasoup. The TypeScript consumer side is generated
by the protoc-gen-proto4webrtc-ts npm package.
"""

from proto4webrtc_codegen.driver import generate

__all__ = ["generate"]
