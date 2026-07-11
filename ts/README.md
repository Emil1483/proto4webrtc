# protoc-gen-proto4webrtc-ts

protoc plugin generating typed [mediasoup](https://mediasoup.org/)
**consumer** wrappers (mediasoup-client) from protobuf messages annotated
with `proto4webrtc` options. The Python **producer** counterpart is the pip
package `proto4webrtc`.

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
    strategy: all
```

```ts
import { TelemetryStream } from "./gen/proto4webrtc";

TelemetryStream.attach(dataConsumer, (msg) => console.log(msg.value0));
```

Data streams also get `TelemetryStream.subscribe(sfu, onMessage)` — a typed
wrapper for server-side, in-process access (no browser, no WebRTC) over a
[`Proto4WebrtcSfu`](proto4webrtc/README.md) (npm package `proto4webrtc`,
`ts/proto4webrtc` in this repo — the mediasoup SFU runtime).

Full docs: https://github.com/Emil1483/proto4webrtc
