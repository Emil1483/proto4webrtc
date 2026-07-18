# proto4webrtc

Define your WebRTC data/media streams once in protobuf, generate typed
[mediasoup](https://mediasoup.org/) code for both ends:

- **Python producer runtime** (robot / backend, [pymediasoup](https://github.com/skymaze/pymediasoup)) — pip package [`proto4webrtc`](https://pypi.org/project/proto4webrtc/) (`python/proto4webrtc`)
- **Python code generator** — pip package [`proto4webrtc-codegen`](https://pypi.org/project/proto4webrtc-codegen/) (`python/proto4webrtc_codegen`), pulled in by `pip install proto4webrtc[compiler]`
- **TypeScript consumer generator** (browser, [mediasoup-client](https://www.npmjs.com/package/mediasoup-client)) — npm package [`protoc-gen-proto4webrtc-ts`](https://www.npmjs.com/package/protoc-gen-proto4webrtc-ts) (`ts/proto4webrtc_codegen`)
- **TypeScript SFU runtime** (server, [mediasoup](https://mediasoup.org/)) — npm package [`proto4webrtc`](https://www.npmjs.com/package/proto4webrtc) (`ts/proto4webrtc`)

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

// Typed rpc from the browser to the robot, over WebRTC data channels
// ("<label>/requests" browser->robot, "<label>/responses" robot->browsers).
// Unary methods only.
message PingRequest { double stamp = 1; }
message PingResponse { double stamp = 1; }

service Control {
  option (proto4webrtc.rpc_service) = {label: "control"};

  rpc Ping(PingRequest) returns (PingResponse);
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
pip install proto4webrtc[compiler]   # runtime + generator; plain `proto4webrtc` is runtime-only
python -m proto4webrtc_codegen --proto path/to/protos --out out/
```

The driver runs protoc for you (bundled via grpc_tools — no system protoc
needed), and `proto4webrtc/options.proto` is bundled: if your proto root
doesn't contain it, it's added to the include path automatically. `--proto`
is repeatable for multiple roots.

Output in `out/`:

- `<your packages>/*_pb2.py` (+ `.pyi`) — protobuf message classes
- `proto4webrtc_gen/producers.py` — the mediasoup producer wrappers

The generator ships as its own distribution (`proto4webrtc-codegen`), so
production images can install just the runtime: generated code only needs
`pip install proto4webrtc`.

Prefer raw protoc? The codegen package also installs the plugin executable.
Note `proto4webrtc/options.proto` is **not** a positional target below —
only `-I`-resolved as an import, so protoc doesn't generate a competing
`proto4webrtc/options_pb2.py` (see Options reference below for why):

```sh
protoc -I protos \
  --python_out=out --proto4webrtc_python_out=out \
  protos/example/streams.proto
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
- `proto4webrtc_react.ts` — the `useSfu()` React hook (only with `opt: [react]`)

Pass `opt: [react]` to the plugin to additionally generate a React hook (see
"React" under Use below):

```yaml
  - local: protoc-gen-proto4webrtc-ts
    out: src/gen
    opt: [react]
    strategy: all
```

Hook `buf generate` into your `prepare` script so `npm install` / `npm ci`
regenerates.

## 3. Use

### Python (producer side)

`Proto4WebrtcProducer` is the whole client: signaling, device/transport setup
and the reconnect loop are handled for you. One attribute per declared
stream, named `snake_case(message name)`:

```python
from proto4webrtc_gen import Proto4WebrtcProducer, Telemetry

client = Proto4WebrtcProducer(signaling_url="ws://localhost:3000/api/sfu")
client.run_forever()  # blocking: connects, reconnects on drop, until stop()

# from any thread, anytime — safe no-op before the first connection:
client.telemetry.send(Telemetry(stamp=time.time(), value0=0.4, value1=-0.2))
client.camera.push(frame)  # av.VideoFrame/AudioFrame, or a numpy ndarray (rgb24)
```

Rpc services: subclass the generated abstract base, implement its `async`
methods (they run on the client's event loop — offload blocking work with
`asyncio.to_thread()`), and hand an instance to the producer; browser calls
are dispatched into it, exceptions travel back as rpc errors:

```python
from proto4webrtc_gen import ControlBase, PingResponse

class Control(ControlBase):
    async def ping(self, request):
        return PingResponse(stamp=request.stamp)

client = Proto4WebrtcProducer(signaling_url=..., control=Control())
```

Delivery and backpressure declared in the protofile are baked into each
stream's `send()`: it encodes, checks the channel state, and (for
`DROP_IF_BUFFERED`) drops the message instead of queueing lag — returning
`False` when a message was dropped (or `None` when called off the client's
event loop thread, e.g. a ROS callback — dispatched, but the result can't be
observed synchronously). `push()` feeds a track the client owns internally;
no manual aiortc track/queue/pts code needed.

### TypeScript (consumer side, browser)

`connectToSfu()` (generated; wraps `proto4webrtc/client`) does the whole
setup — WebSocket signaling, Device load, receive transport, ICE config
(served by the SFU) — and returns the client extended with a typed
`subscribeTo<Stream>()` method per declared stream:

```ts
import { connectToSfu } from "./gen/proto4webrtc";

const client = await connectToSfu(); // default url: ws(s)://<host>/api/sfu

client.subscribeToTelemetryStream((msg) => {
  console.log(msg.stamp, msg.value0);
});
client.subscribeToCameraStream((track) => {
  videoEl.srcObject = new MediaStream([track]);
});
client.onProducerClosed((label) => {
  /* a producer went away — label tells you which stream/process */
});
client.close();
```

Rpc services surface as typed methods on `client.rpc` (every annotated
service's methods, camelCased, merged onto one object). Requests take the
protobuf-es init shape; failures (handler exception on the robot, or a
timeout — default 10 s) reject the promise:

```ts
const res = await client.rpc.ping({ stamp: Date.now() / 1000 });
await client.rpc.setLight({ intensity: 0.5 }, { timeoutMs: 3000 });
```

Each subscribe covers the producer already online at call time and any that
(re)appears later, and consumes only what was asked for — the SFU never sends
this peer the streams it didn't subscribe to. Messages with a scalar `stamp`
field are deduplicated automatically: out-of-order (stale) messages are
dropped before the callback. Lower-level `attach()` (raw mediasoup
DataConsumer) and `decode()` remain available for manual wiring.

### React (consumer side, browser)

With `opt: [react]`, `useSfu()` (generated into `proto4webrtc_react.ts`)
wraps the whole lifecycle in one hook. Pass an options object per label to
subscribe to it; every declared data-stream label comes back as a
`{ hz, latest, online }` state, updated inside a single
`requestAnimationFrame` loop (so a 100 Hz stream re-renders at display rate,
not message rate):

```tsx
import { useSfu } from "./gen/proto4webrtc_react";

const { telemetry, client, connectionState, robotOnline } = useSfu({
  telemetry: {
    forceInOrder: true, // drop messages stamped older than `latest`
    onMessage: (msg) => {}, // optional: every message, synchronously
  },
});
// telemetry.latest — newest Telemetry (undefined before the first one)
// telemetry.hz     — messages received in the last second
// telemetry.online — a "telemetry" producer is registered at the SFU
// connectionState  — receive transport state ("new", "connected", ...)
// robotOnline      — true while the SFU has at least one producer
// onlineLabels     — every label currently produced ("<service>/responses"
//                    online means the rpc service is being served)

const { pointcloud } = useSfu({ pointcloud: {} }); // only "pointcloud" is consumed
```

Unsubscribed labels stay at `hz: 0` / `latest: undefined` — but their
`online` still tracks the producer, so a label can be watched for liveness
without consuming its messages. `forceInOrder` is
only offered for messages with a scalar `stamp` field. Media tracks and rpc
go through the returned `client` (a `StreamsClient`, `null` while
connecting).

### TypeScript (SFU side, server)

`npm install proto4webrtc`. `Proto4WebrtcSfu` is the whole server: signaling,
Worker/Router/transport setup, and the reconnect-tolerant registries are
handled for you — sane defaults, every field overridable.

```ts
import { Proto4WebrtcSfu } from "proto4webrtc";
import { TelemetryStream } from "./gen/proto4webrtc";

const sfu = new Proto4WebrtcSfu();

// e.g. api/sfu/route.ts (next-ws), or any node `ws` server:
export async function UPGRADE(client: import("ws").WebSocket) {
  sfu.handleWSClient(client);
}

// e.g. api/status/route.ts:
export function GET() {
  return Response.json(sfu.getStatus());
}

// anywhere else in the same server process — no websocket, no browser:
const unsubscribe = TelemetryStream.subscribe(sfu, (msg) => {
  console.log(msg.stamp, msg.value0);
});
```

`subscribe()` (generated per data stream, wrapping `Proto4WebrtcSfu.subscribe()`)
is in-process access to a data stream via a mediasoup `DirectTransport` — no
browser, no WebRTC. Safe to call before the matching producer connects, and
keeps working across producer reconnects. Real WebRTC media/video consumption
is unchanged — browsers still connect to `handleWSClient`'s signaling
endpoint with real `mediasoup-client`.

## Multiple robot producers

Nothing limits the SFU to a single robot process. It is one shared "room"
keyed by stream label: several producer processes (e.g. two containers on
one robot — one pushing telemetry/media, one implementing configuration
rpcs) can each run their own `Proto4WebrtcProducer` against the same
signaling URL, and browsers see the union of their streams. Rpc routing
stays clean automatically: each producer process consumes only the
`"<label>/requests"` channels of the services *it* was handed, so a call to
`client.rpc.getMission()` is answered by whichever container implements the
`mission` service.

Two rules:

- **Split the protos per process.** `Proto4WebrtcProducer` produces *every*
  stream declared in the generated `producers.py`, so each process must be
  generated from its own proto file (or file set) — telemetry streams in
  one, configuration services in another. If two processes share generated
  code, both produce the same labels and consumers receive every message
  twice. One proto root can serve all processes: restrict each generation
  with `--include` (CLI) / `include=` (`generate()`) globs, e.g.
  `python -m proto4webrtc_codegen --proto protos --include 'rov/config/*.proto' --out out/`.
- **Labels stay globally unique** across all processes connected to one SFU
  (the browser selects by label alone).

When the producer processes' generated code can land on one `sys.path`
(e.g. two ament_python packages in a colcon workspace), also keep the
*Python package names* disjoint: pass `gen_package=` to `generate()`
(`--gen-package` on the CLI) so each process gets its own wrapper package
instead of two colliding `proto4webrtc_gen`s, and give the proto packages
distinct top-level names (`rov` and `rov_config`, not `rov.streams` and
`rov.config`) — same-named regular Python packages shadow each other.

Consumer-side liveness is per label, not per process:
`client.onProducerClosed((label) => ...)` reports which stream went away,
and in React each `useSfu()` stream state carries `online` — so a browser
can tell "telemetry container dropped" from "configurator dropped" by the
labels each one owns. `robotOnline` is coarser — true while *any* producer
is online.

The full setup — two ROS2 producer packages in one container
(`webrtc_streamer_pkg` + `webrtc_configurator_pkg`), and a GUI homescreen
showing per-process liveness — lives in [`example/`](example/README.md).

One caveat for rpcs like `restartContainers()` that restart the very
process serving them: schedule the restart (e.g. `asyncio.get_event_loop()
.call_later(...)` or a detached docker call) and return first, or the
response never leaves the dying process and the browser sees a timeout.

## Options reference

| Option                | Applies to | Meaning                                                                                                         |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `label`               | both       | Unique mediasoup producer label; consumers select by it                                                         |
| `delivery`            | data       | `RELIABLE_ORDERED` (default; required for >64 KiB messages) or `UNRELIABLE`                                     |
| `backpressure`        | data       | `BUFFER_ALL` (default) or `DROP_IF_BUFFERED` (newest wins)                                                      |
| `max_buffered_factor` | data       | `DROP_IF_BUFFERED` threshold, in multiples of message size (default 2)                                          |
| `kind`                | media      | `VIDEO` or `AUDIO`                                                                                              |
| `video_codec`         | media      | `VP8`, `VP9`, `H264`, or unset for router default                                                               |
| `label` (rpc)         | service    | Base channel label; `<label>/requests` and `<label>/responses` are derived and share the stream label namespace |

The plugins never read `options.proto` at generation time — protoc compiles
annotations into the descriptors it hands them. The file only matters when
_authoring_ protofiles (BSR dep above, or the copy bundled in the pip
package).

`proto4webrtc/options.proto` is resolved as an _import only_ when generating
Python — never compiled into a per-project `proto4webrtc/options_pb2.py`.
That module already ships inside the `proto4webrtc` pip package itself
(`python/proto4webrtc/options_pb2.py`, checked in, regenerated only when
`options.proto` changes — see Development below), because `proto4webrtc` is
also the name of the producer runtime package: a second, per-project
`proto4webrtc/` directory would be a same-named, colliding top-level Python
package, and whichever one landed first on `sys.path` would silently shadow
the other.

## Development

```sh
# Python: editable installs (runtime + codegen dists) + generate from the
# example protos. Run pytest from inside each dist dir — from python/ itself
# the dist dirs shadow the same-named packages.
pip install -e python/proto4webrtc -e python/proto4webrtc_codegen
python -m proto4webrtc_codegen --proto example/proto --out example/gen-py

# Only after changing proto/proto4webrtc/*.proto — sync the copies bundled in
# the codegen package and refresh the runtimes' checked-in compiled modules
# (python/proto4webrtc/proto4webrtc/{options,rpc}_pb2.py and
# ts/proto4webrtc/src/gen/proto4webrtc/rpc_pb.ts)
cp proto/proto4webrtc/*.proto python/proto4webrtc_codegen/proto4webrtc_codegen/proto/proto4webrtc/
python -c "
from grpc_tools import protoc
from importlib import resources
protoc.main(['protoc', '-Ipython/proto4webrtc_codegen/proto4webrtc_codegen/proto',
             '-I' + str(resources.files('grpc_tools') / '_proto'),
             '--python_out=python/proto4webrtc', '--pyi_out=python/proto4webrtc',
             'proto4webrtc/options.proto', 'proto4webrtc/rpc.proto'])
"
ts/proto4webrtc_codegen/node_modules/.bin/buf generate --path proto/proto4webrtc/rpc.proto \
  --template '{"version":"v2","inputs":[{"directory":"proto"}],"plugins":[{"local":"ts/proto4webrtc_codegen/node_modules/.bin/protoc-gen-es","out":"ts/proto4webrtc/src/gen","opt":["target=ts"]}]}'

# TypeScript codegen plugin: deps + generate from the example protos
npm --prefix ts/proto4webrtc_codegen install
buf generate --template example/buf.gen.yaml

# TypeScript SFU runtime: install, typecheck, test
npm --prefix ts/proto4webrtc install
npm --prefix ts/proto4webrtc run typecheck
npm --prefix ts/proto4webrtc test
```

## Publishing

All four packages (pip `proto4webrtc`, pip `proto4webrtc-codegen`, npm
`proto4webrtc`, npm `protoc-gen-proto4webrtc-ts`) share one version number —
bump `python/proto4webrtc/pyproject.toml`,
`python/proto4webrtc_codegen/pyproject.toml` (including the
`compiler` extra pin in the runtime's pyproject),
`ts/proto4webrtc/package.json`, and `ts/proto4webrtc_codegen/package.json`
together before publishing.

- Options module: `buf registry login`, then `buf push --exclude-unnamed` from
  the repo root (skips the unnamed example module, which cannot be pushed).
- pip (each of `python/proto4webrtc` and `python/proto4webrtc_codegen`):
  `python -m build && twine upload dist/*`
- npm: log in once with `npm login` (browser flow; check with `npm whoami`), then:
  - codegen plugin: `cd ts/proto4webrtc_codegen && npm publish`
  - runtime (SFU + browser client): `cd ts/proto4webrtc && npm run build && npm test && npm publish`
