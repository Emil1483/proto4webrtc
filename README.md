# proto4webrtc

Define your WebRTC data/media streams once in protobuf, generate typed
[mediasoup](https://mediasoup.org/) code for both ends:

- **Python producer** (robot / backend, [pymediasoup](https://github.com/skymaze/pymediasoup)) — pip package [`proto4webrtc`](https://pypi.org/project/proto4webrtc/)
- **TypeScript consumer** (browser, [mediasoup-client](https://www.npmjs.com/package/mediasoup-client)) — npm package [`protoc-gen-proto4webrtc-ts`](https://www.npmjs.com/package/protoc-gen-proto4webrtc-ts)

Both are standard protoc plugins, so they compose with protoc or
[buf](https://buf.build). Other languages can be added as sibling plugins.

## 1. Declare streams

Annotate messages with the options from
[`proto4webrtc/options.proto`](proto/proto4webrtc/options.proto)
(module `buf.build/emil1483/proto4webrtc` on the Buf Schema Registry):

```proto
syntax = "proto3";

package example;

import "proto4webrtc/options.proto";

// Binary protobuf over an SCTP data channel.
message Telemetry {
  option (proto4webrtc.data_stream) = {
    label: "telemetry"        // unique channel label
    delivery: UNRELIABLE      // or RELIABLE_ORDERED (default)
    backpressure: BUFFER_ALL  // or DROP_IF_BUFFERED (newest wins)
  };

  double stamp = 1;
  float value0 = 2;
  float value1 = 3;
}

// Declaration-only: frames travel as RTP, message must stay empty.
message Camera {
  option (proto4webrtc.media_stream) = {
    label: "camera"
    kind: VIDEO
    video_codec: VP8
  };
}
```

For editor/lint support while designing, depend on the options module:

```yaml
# buf.yaml
version: v2
deps:
  - buf.build/emil1483/proto4webrtc
```

```sh
buf dep update
```

(A full example lives in [`example/proto`](example/proto).)

## 2. Generate

### Python producers

```sh
pip install proto4webrtc
python -m proto4webrtc_codegen --proto path/to/protos --out out/
```

The driver runs protoc for you (bundled via grpc_tools — no system protoc
needed), and `proto4webrtc/options.proto` is bundled: if your proto root
doesn't contain it, it's added to the include path automatically. `--proto`
is repeatable for multiple roots.

Output in `out/`:

- `<your packages>/*_pb2.py` (+ `.pyi`) — protobuf message classes
- `proto4webrtc_gen/producers.py` — the mediasoup producer wrappers

Prefer raw protoc? The pip package also installs the plugin executable:

```sh
protoc -I protos \
  --python_out=out --proto4webrtc_python_out=out \
  protos/example/streams.proto proto4webrtc/options.proto
```

### TypeScript consumers

```sh
npm install --save-dev protoc-gen-proto4webrtc-ts @bufbuild/protoc-gen-es @bufbuild/buf
npm install @bufbuild/protobuf
```

```yaml
# buf.gen.yaml
version: v2
plugins:
  - local: protoc-gen-es
    out: src/gen
    opt: [target=ts]
  - local: protoc-gen-proto4webrtc-ts
    out: src/gen
    strategy: all # the plugin aggregates all streams into one file
```

```sh
buf generate
```

Output in `src/gen/`:

- `<your packages>/*_pb.ts` — protobuf-es message classes
- `proto4webrtc.ts` — the mediasoup consumer wrappers

Hook `buf generate` into your `prepare` script so `npm install` / `npm ci`
regenerates.

## 3. Use

### Python (producer side)

```python
from proto4webrtc_gen import Telemetry, TelemetryProducer, CameraProducer

# transport: an open pymediasoup send transport
telemetry = await TelemetryProducer.create(transport)
camera = await CameraProducer.create(transport, track)  # aiortc track

telemetry.send(Telemetry(stamp=time.time(), value0=0.4, value1=-0.2))
```

Delivery and backpressure declared in the protofile are baked into the
wrapper: `send()` encodes, checks the channel state, and (for
`DROP_IF_BUFFERED`) drops the message instead of queueing lag. It returns
`False` when a message was dropped.

### TypeScript (consumer side)

```ts
import { TelemetryStream, CameraStream, type Telemetry } from "./gen/proto4webrtc";

// Find the producers by label (however your signaling exposes them), then:
TelemetryStream.attach(dataConsumer, (msg: Telemetry) => {
  console.log(msg.stamp, msg.value0);
});

// Media streams carry no protobuf — match the RTP producer by label:
//   producer.appData.label === CameraStream.label  (kind: CameraStream.kind)
```

`attach()` decodes every data-channel message into the typed callback;
`decode()` is available for manual wiring.

## Options reference

| Option | Applies to | Meaning |
|---|---|---|
| `label` | both | Unique mediasoup producer label; consumers select by it |
| `delivery` | data | `RELIABLE_ORDERED` (default; required for >64 KiB messages) or `UNRELIABLE` |
| `backpressure` | data | `BUFFER_ALL` (default) or `DROP_IF_BUFFERED` (newest wins) |
| `max_buffered_factor` | data | `DROP_IF_BUFFERED` threshold, in multiples of message size (default 2) |
| `kind` | media | `VIDEO` or `AUDIO` |
| `video_codec` | media | `VP8`, `VP9`, `H264`, or unset for router default |

The plugins never read `options.proto` at generation time — protoc compiles
annotations into the descriptors it hands them. The file only matters when
*authoring* protofiles (BSR dep above, or the copy bundled in the pip
package).

## Development

```sh
# Python: editable install + generate from the example protos
pip install -e python
python -m proto4webrtc_codegen --proto example/proto --out example/gen-py

# TypeScript: plugin deps + generate from the example protos
npm --prefix ts install
buf generate --template example/buf.gen.yaml
```

## Publishing

- Options module: `buf registry login`, then `buf push` from the repo root.
- pip: `cd python && python -m build && twine upload dist/*`
- npm: `cd ts && npm publish`
