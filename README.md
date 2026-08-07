# proto4webrtc

Define your WebRTC data/media streams once in protobuf, generate typed
[mediasoup](https://mediasoup.org/) code for both ends:

- **Python producer runtime** (robot / backend, [pymediasoup](https://github.com/skymaze/pymediasoup)) — pip package [`proto4webrtc`](https://pypi.org/project/proto4webrtc/) (`python/proto4webrtc`)
- **Python code generator** — pip package [`proto4webrtc-codegen`](https://pypi.org/project/proto4webrtc-codegen/) (`python/proto4webrtc_codegen`), pulled in by `pip install proto4webrtc[compiler]`; its `.ros2` module also renders ROS2 `.msg`/`.srv` (see [ROS2](#ros2-colcon-workspaces))
- **TypeScript consumer generator** (browser, [mediasoup-client](https://www.npmjs.com/package/mediasoup-client)) — npm package [`protoc-gen-proto4webrtc-ts`](https://www.npmjs.com/package/protoc-gen-proto4webrtc-ts) (`ts/proto4webrtc_codegen`)
- **TypeScript SFU runtime** (server, [mediasoup](https://mediasoup.org/)) — npm package [`proto4webrtc`](https://www.npmjs.com/package/proto4webrtc) (`ts/proto4webrtc`)

Both are standard protoc plugins, so they compose with protoc or
[buf](https://buf.build). Other languages can be added as sibling plugins.

## 1. Declare streams

Annotate messages with the options from
[`proto4webrtc/options.proto`](proto/proto4webrtc/options.proto)
(module `buf.build/djupvik/proto4webrtc` on the Buf Schema Registry):

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
    video_codec: VP8  // or H264; unset = router default. See "Choosing a video codec"
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
  - buf.build/djupvik/proto4webrtc
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

#### Reconnecting

A lost session reconnects on its own — the signaling socket closing, or the
receive transport reaching `failed`/`closed` (what a phone does after a while
with the browser in the background: it comes back to a dead session that used
to need a page refresh). The hook drops the old client, waits out a backoff,
connects again, and re-subscribes every label; `reconnecting` /
`reconnectAttempt` describe the gap, and `reconnect()` forces one now. Coming
back to a visible tab (or `online` firing) pings the current session and
reconnects immediately if the ping fails, instead of sitting out the backoff.

Defaults are retry forever, one second apart. The attempt counter resets on
every successful connect. Override through the same
`Proto4WebrtcClientOptions` object:

```tsx
const { telemetry, reconnecting, reconnectAttempt, reconnect } = useSfu(
  { telemetry: {} },
  {
    reconnectAttempts: -1,                  // -1 (default) = unlimited, 0 = off
    reconnectInterval: 1000,                // ms, or (attempt) => ms for backoff
    shouldReconnect: (event) => event.code !== 4401, // socket CloseEvent
    onReconnectStop: (numAttempts) => toast(`gave up after ${numAttempts}`),
    onConnectError: (err, attempt) => {           // one per failed attempt
      if (attempt === 1) toast(err.message);      // the rest ride the chip
    },
  },
);
```

Transport-side losses have no socket close behind them, so `shouldReconnect`
gets a synthetic `CloseEvent` with a private code: 4000 connect failed, 4001
transport failed, 4002 transport closed.

Failed connects are yours to present: `onConnectError` fires once per attempt
(so once a second while the SFU is down — a dev server restart included) and
the library shows nothing itself. Without the handler it falls back to a
`console.warn`, never a `console.error`, so a retry loop doesn't raise a
framework error overlay.

On the plain client (no React), `client.onClosed(cb)` reports the same losses
— everything in flight is rejected first, so a pending request can't hang on
a dead socket — and `client.ping()` round-trips a signaling request with a
timeout to check whether a session that looks open really is.

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

> ⚠️ If you use Next.js to host the SFU, please make sure your next.config.ts contains the following

```ts
const nextConfig: NextConfig = {
  // mediasoup is a native lib; keep it external (don't bundle) and make sure its
  // worker binary is copied into the standalone output (it's spawned by path,
  // not require()'d, so tracing misses it otherwise).
  serverExternalPackages: ["mediasoup"],
  outputFileTracingIncludes: {
    "/api/sfu": ["./node_modules/mediasoup/worker/out/**/*"],
  },
};
```

## Multiple robot producers

Nothing limits the SFU to a single robot process. It is one shared "room"
keyed by stream label: several producer processes (e.g. two containers on
one robot — one pushing telemetry/media, one implementing configuration
rpcs) can each run their own `Proto4WebrtcProducer` against the same
signaling URL, and browsers see the union of their streams. Rpc routing
stays clean automatically: each producer process consumes only the
`"<label>/requests"` channels of the services _it_ was handed, so a call to
`client.rpc.getMission()` is answered by whichever container implements the
`mission` service.

### Splitting the streams between processes

Processes sharing one generated bundle declare which labels they own with
`streams=`:

```python
from proto4webrtc_gen import (
    CameraStreamProducer,
    Proto4WebrtcProducer,
    ThrustersProducer,
    PointCloudProducer,
)

# process A: telemetry only
client = Proto4WebrtcProducer(signaling_url=..., streams=[ThrustersProducer, PointCloudProducer])

# process B: video only — crashes here don't touch telemetry
client = Proto4WebrtcProducer(signaling_url=..., streams=[CameraStreamProducer])

# process C: rpc only, no stream at all
client = Proto4WebrtcProducer(signaling_url=..., streams=[], control=Control())
```

`streams=` takes the generated producer classes or their wire labels
(`streams=["telemetry", "pointcloud"]` — handy when the split comes from
config, e.g. a ROS2 parameter). Omitting it produces every declared stream,
which is what a single-process robot wants. A stream this process left out
still has its attribute, but using it raises instead of silently going
nowhere:

```python
client.camera_stream.push(frame)
# RuntimeError: stream 'camera' is not produced by this client: pass
# streams=[CameraStreamProducer] (or streams=['camera']) ...
```

Rpc services are opt-in the same way: only the implementations handed to the
constructor have their `"<label>/requests"` channels consumed here.

Two rules:

- **Every label has exactly one owner.** Two processes producing the same
  label means consumers receive every message twice — the SFU does not
  dedupe. `streams=` is how you keep the ownership explicit and reviewable in
  one place.
- **Labels stay globally unique** across all processes connected to one SFU
  (the browser selects by label alone).

How far to take one bundle is a build-layout question, separate from label
ownership:

- Processes built from the **same** code (several nodes in one ROS2 package,
  several entry points in one image) share one bundle and split it with
  `streams=`. No extra codegen, no proto shuffling to add a process.
- Processes built from **different** code generate their own bundle, each from
  only the protos it needs: `include=` (`--include`) globs narrow what is
  compiled, so no package carries generated code it never imports. When two
  such bundles can land on one `sys.path`, give each its own wrapper package
  name with `gen_package=` (`--gen-package`) — same-named regular Python
  packages shadow each other — and keep the proto packages' top-level names
  distinct too (`rov` and `rov_config`, not `rov.streams` and `rov.config`).

`include=` never changes what a client produces; only `streams=` does.

Consumer-side liveness is per label, not per process:
`client.onProducerClosed((label) => ...)` reports which stream went away,
and in React each `useSfu()` stream state carries `online` — so a browser
can tell "telemetry container dropped" from "configurator dropped" by the
labels each one owns. `robotOnline` is coarser — true while _any_ producer
is online.

The full setup — four producer processes in one container (three nodes sharing
`webrtc_streamer_pkg`'s bundle, one in `webrtc_configurator_pkg` with its own),
and a GUI homescreen showing per-process liveness — lives in
[`example/`](example/README.md).

One caveat for rpcs like `restartContainers()` that restart the very
process serving them: schedule the restart (e.g. `asyncio.get_event_loop()
.call_later(...)` or a detached docker call) and return first, or the
response never leaves the dying process and the browser sees a timeout.

## ROS2 (colcon workspaces)

Nothing about the runtime is ROS-specific — an `ament_python` node just imports
the generated package. The two things that need care are _when_ codegen runs and
_how_ the pip dependency reaches the interpreter colcon builds against.

### Generate from `setup.py`

Run `generate()` at `setup.py` time, so `colcon build` is the whole workflow:
no separate generate step to forget, no `PYTHONPATH` to export, and no way to
build against a stale encoder. Generate straight into the package's own
directory — the generated top-level packages (e.g. `rov`, `proto4webrtc_gen`)
land beside `my_streamer/` and are picked up by the ordinary `find_packages()`
call below, no `package_dir` grafting needed:

```python
# src/my_streamer/setup.py
from pathlib import Path

from setuptools import find_packages, setup

from proto4webrtc_codegen import generate

package_name = 'my_streamer'

# Regenerate the stream code (pb2 messages + mediasoup producer wrappers)
# from the repo's protofiles on every build. proto4webrtc/options.proto is
# bundled with the pip package and added to the include path automatically.
# The generated top-level packages land next to my_streamer/ and are picked
# up by find_packages() below.
#
# include: only the protos this package's nodes import. Pass gen_package= too
# when a second ament_python package in the same workspace also generates, so
# the two wrapper packages don't shadow each other on the shared sys.path.
_here = Path(__file__).resolve().parent
generate(
    proto_dirs=[_here.parents[2] / 'proto'],
    out_dir=_here,
    include=['telemetry/*.proto', 'camera/*.proto'],
)

setup(
    name=package_name,
    version='0.0.1',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='user',
    maintainer_email='you@example.com',
    description='Bridges ROS2 topics to the server over WebRTC (aiortc peers)',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'telemetry_node = my_streamer.telemetry_node:main',
            'camera_node = my_streamer.camera_node:main',
        ],
    },
)
```

One package, several nodes, one bundle: the entry points above are separate
_processes_, and each names the labels it owns:

```python
# src/my_streamer/my_streamer/telemetry_node.py
client = Proto4WebrtcProducer(signaling_url=url, streams=[ThrustersProducer])

# src/my_streamer/my_streamer/camera_node.py — separate process, same package
client = Proto4WebrtcProducer(signaling_url=url, streams=[CameraStreamProducer])
```

That is the point of the split: the camera process can die (encoder, driver,
OOM) and telemetry keeps publishing, with the browser marking only `camera`
offline. Before `streams=`, one process per label set meant one _package_ per
process — its own `generate()` call, its own `gen_package` name, its own
`include=` subset. A package still generates its own bundle when its nodes need
_different protos_ (that is what `include=` and `gen_package=` are for); it no
longer has to just to own a different label.

A CMake (`ament_cmake`) package does the same with `execute_process` at
_configure_ time plus `CMAKE_CONFIGURE_DEPENDS` on `*.proto`, so editing a
proto triggers a reconfigure instead of silently keeping the old output — which
is exactly how the interface package below is built.

### Generate the ROS2 interfaces from the same protos

`proto4webrtc_codegen.ros2` renders ROS2 `.msg` and `.srv` files, so the
protofiles are the single source of truth for the ROS graph too — no
hand-maintained interface package drifting from the wire contract. It needs no
proto4webrtc annotation to work, so ROS-only types (a message no stream
produces) belong in the same tree.

Run it from an `ament_cmake` interface package at _configure_ time. Only
`CMakeLists.txt` and `package.xml` are committed; `msg/` and `srv/` are
generated and gitignored:

```cmake
# src/my_interfaces/CMakeLists.txt
cmake_minimum_required(VERSION 3.8)
project(my_interfaces)

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(Python3 REQUIRED COMPONENTS Interpreter)

set(PROTO_DIR "$ENV{PROTO_DIR}")  # or a path relative to CMAKE_CURRENT_SOURCE_DIR

execute_process(
  COMMAND "${Python3_EXECUTABLE}" -m proto4webrtc_codegen.ros2
          --proto "${PROTO_DIR}" --out "${CMAKE_CURRENT_SOURCE_DIR}"
  RESULT_VARIABLE _gen_result
)
# Fatal on purpose: continuing would build whatever msg/ and srv/ a previous run
# left behind, the one failure mode generating at build time exists to rule out.
if(NOT _gen_result EQUAL 0)
  message(FATAL_ERROR "my_interfaces: codegen failed (exit ${_gen_result})")
endif()

# Reconfigure -- and so regenerate -- when a proto changes. Without this, editing
# a proto and rebuilding silently keeps the old interfaces.
file(GLOB_RECURSE _protos CONFIGURE_DEPENDS "${PROTO_DIR}/*.proto")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${_protos})

file(GLOB _interfaces RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}" msg/*.msg srv/*.srv)
list(SORT _interfaces)
rosidl_generate_interfaces(${PROJECT_NAME} ${_interfaces})

ament_export_dependencies(rosidl_default_runtime)
ament_package()
```

`--include 'telemetry/*.proto'` narrows the set (imports still resolve),
`--no-services` skips `.srv`, and `--srv-prefix-service` names srv files
`<Service><Method>.srv` for when two services share a method name. Unchanged
files are not rewritten (an unchanged proto costs no rosidl rebuild), and files
the generator wrote before but no longer would are removed — hand-written
interfaces beside them are left alone.

The mapping:

| proto | ROS2 |
| --- | --- |
| `message Foo` | `msg/Foo.msg` |
| nested `Foo.Bar` | `msg/FooBar.msg` (one flat namespace, so names must be globally unique) |
| `rpc Do(DoRequest) returns (DoResponse)` | `srv/Do.srv`, request fields above `---`, response below |
| scalar fields | same width/signedness (`sint32` → `int32`; the zigzag is a wire detail) |
| `bytes` | `uint8[]` |
| `repeated T` | `T[]` |
| enum field | `int32` field + an `UPPER_SNAKE` constants block, proto's numbers |

A message that exists only to be an rpc payload (`*Request`/`*Response` by
name, or empty) gets no `.msg` — it is rendered into its `.srv`. One that is
also a field type elsewhere keeps its `.msg`. Declaration-only
`(proto4webrtc.media_stream)` messages are skipped: RTP frames never travel as
protobuf.

What it refuses, rather than approximating: `oneof` (flattening loses the
exactly-one-set invariant), `map<>`, `repeated bytes` (a nested array), streaming
rpcs, references into files the target set leaves out, field names that aren't
`lower_snake_case` or that are C++/Python keywords, non-`CamelCase` message
names, and colliding flattened names. Each raises with the `.proto` and field
named, at configure time — not as an opaque failure inside `rosidl`.

### Relaying an rpc to a plain ROS2 service

Because both sides come from one definition, the node holding the WebRTC
connection doesn't have to implement the rpc: it can forward the call to the
generated ROS2 service and let whichever node owns the logic answer. The
producer node becomes a thin relay.

```python
class Greeter(GreeterBase):
    """browser -> this node -> ROS2 service /greet -> the node that owns it."""

    def __init__(self, node: Node):
        super().__init__()
        self._node = node
        self._client = node.create_client(RosGreet, "greet")  # my_interfaces/srv/Greet

    async def greet(self, request: GreetRequest) -> GreetResponse:
        if not self._client.service_is_ready():
            # Raised, not swallowed: it reaches the browser as an rpc error.
            raise RuntimeError("ROS2 service /greet is not available")
        future = self._client.call_async(RosGreet.Request(name=request.name))
        # Polled, not spin_until_future_complete(): this coroutine runs on the
        # producer's asyncio loop (the one the data channels live on) while the
        # future is completed by the executor on the rclpy spin thread —
        # blocking here would deadlock the loop.
        while not future.done():
            await asyncio.sleep(0.01)
        result = future.result()
        return GreetResponse(message=result.message, count=result.count)
```

Handler exceptions and timeouts travel back to the caller as rpc errors, so the
GUI can tell "the producer node is down" (the `<label>/responses` label goes
offline) from "the producer is up but the service node isn't" (the call rejects).
A worked version — browser page, relay, and the ROS2 service server as a
separate node — is in [`example/`](example/README.md).

### Declare the dependency in `pyproject.toml`, install with uv into a venv

`package.xml` cannot express this: rosdep keys resolve to apt packages, and
neither `proto4webrtc` nor `proto4webrtc-codegen` is on apt. Declaring them
there only makes `rosdep install` fail. So the versions live in a
`pyproject.toml` next to the workspace, installed with [uv](https://docs.astral.sh/uv/)
— one place to pin from, and a lockfile (`uv.lock`) that the image build and
the devcontainer share:

```toml
# robot/pyproject.toml — no package to build, just a place to pin from
[project]
name = "my-robot-ws"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    # colcon belongs here, not in apt: it runs each ament_python package's
    # setup.py with its own sys.executable, and setuptools stamps that
    # interpreter into every console script's shebang — an apt colcon builds
    # nodes that cannot import anything from this venv. That is exactly how
    # `ros2 launch` fails with ModuleNotFoundError: No module named
    # 'proto4webrtc' while `python -c "import proto4webrtc"` succeeds.
    "colcon-common-extensions",
    # Capped below 80: `colcon build --symlink-install` shells out to
    # `setup.py develop --editable`, and setuptools 80 removed the develop
    # command outright ("error: option --editable not recognized").
    "setuptools<80",
    # Pinned below 4 deliberately. colcon-core depends on empy unbounded and
    # resolves 4.x, which lands in the venv and shadows the apt empy 3.3.4 that
    # Humble's rosidl_adapter is written against. The 4.x API rename fails as
    # `AttributeError: 'NoneType' object has no attribute 'shutdown'` in the
    # middle of a message build, which points nowhere near the real cause.
    "empy>=3.3.4,<4",

    # Codegen, imported by setup.py at build time.
    "proto4webrtc-codegen>=1.5.0,<2",
]

[project.optional-dependencies]
# The producer runtime, imported by the node at run time. An extra rather than a
# plain dependency so the deployed image can install it without build tooling.
runtime = ["proto4webrtc>=1.5.0,<2"]

[tool.uv]
package = false
```

Create the venv with `--system-site-packages` and let it own `colcon`:

```sh
# --system-site-packages is mandatory: rclpy, rosidl_adapter's `em` and
# ament_package are apt packages in the system dist-packages and cannot be
# pip-installed. An isolated venv hides them and nothing builds or runs.
# --python is pinned because uv otherwise picks the newest interpreter it finds,
# and ROS's Python version is fixed by the distro (3.10 on Humble).
uv venv --python /usr/bin/python3 --system-site-packages .venv
UV_PROJECT_ENVIRONMENT=.venv uv sync --frozen --extra runtime

# No activation needed if .venv/bin is first on PATH (bake `ENV PATH` in the
# image / devcontainer so tasks and non-login shells agree on the interpreter).
source /opt/ros/humble/setup.bash
.venv/bin/colcon build --symlink-install
```

The venv's `colcon` is what makes `setup.py`'s `from proto4webrtc_codegen import
generate` resolve, and what stamps the venv interpreter into the built nodes'
shebangs so `import proto4webrtc` works at run time. Point VS Code at it with
`"python.defaultInterpreterPath": "${workspaceFolder}/.venv/bin/python"`.

A deployed image needs neither the venv nor the codegen dist — install just
`proto4webrtc` (see the [`example/`](example/README.md) Dockerfile) and copy in
the `colcon build` output.

### Editor support for the protofiles (VS Code)

Install [`bufbuild.vscode-buf`](https://marketplace.visualstudio.com/items?itemName=bufbuild.vscode-buf).
It drives `buf lsp`, which reads `buf.yaml`/`buf.lock` and resolves BSR imports
like `proto4webrtc/options.proto` out of buf's own module cache — the same cache
`buf generate` uses — so there is no include path to configure and no vendored
copy of the deps in the tree.

Two things to get right:

- **Write the lockfile.** `buf dep update` resolves the `deps:` in `buf.yaml`
  and writes `buf.lock`. Commit it — it pins the exact module commit the
  generated code was built against.
  ```sh
  cd proto && buf dep update
  ```
- **Warm the cache before opening the editor**, or the LSP reports
  `proto4webrtc/options.proto: does not exist` on a fresh clone / container.
  Do it in `postCreateCommand` (or your setup script):
  ```sh
  cd proto && buf build --output /dev/null
  ```
  `buf build` rather than `buf dep update` here: it downloads exactly the
  commits already in `buf.lock` instead of re-resolving the deps and rewriting
  it. `--output /dev/null` throws the image away — the download is the point.

The extension needs `buf` on `PATH` (or set `buf.commandLine.path`); in a
devcontainer, copy it from the official image and list the extension in
`devcontainer.json`:

```dockerfile
COPY --from=bufbuild/buf:1.71.0 /usr/local/bin/buf /usr/local/bin/buf
```

```jsonc
// .devcontainer/devcontainer.json
"customizations": {
  "vscode": {
    "extensions": ["bufbuild.vscode-buf", "ms-python.python"],
    "settings": { "python.defaultInterpreterPath": "/workspace/.venv/bin/python" }
  }
}
```

Pin BSR deps to a release label rather than the default `main` if you need a
specific options version, e.g. `buf.build/djupvik/proto4webrtc:v1.5.1` —
resolving a stale `main` silently drops newer annotations (a missing
`extend google.protobuf.MethodOptions` makes `option (proto4webrtc.protected)`
unknown).

## Authentication

**The SFU does not authenticate.** It enforces a `Role`, which your
application resolves for each peer however it likes (JWT, session cookie,
mTLS, an IdP lookup) and hands to `handleWSClient`. There are three roles
(`proto4webrtc.Role`, exported from the runtime):

- **guest** — least privileged. May subscribe to streams not marked
  `protected` and call rpc methods not marked `protected`.
- **admin** — may subscribe to every stream and call every rpc method.
- **robot** — everything admins can, plus producing streams. This is the
  **default** (`Role.ROBOT === 0`): pass no role and every peer has full
  access, so no-auth works out of the box. A deployment that wants access
  control **must** resolve and pass an explicit role.

Resolve the role in your signaling upgrade handler and pass it in:

```ts
import { Role } from "proto4webrtc";

const role = await resolveRole(request); // your code: verify, map to a Role
if (role === undefined) return client.close(4401, "invalid token"); // reject
sfu.handleWSClient(client, role);
```

Because the browser `WebSocket` API can't set request headers, the token
travels differently per peer — both on the handshake, never in the URL:

- **robot** — an `Authorization: Bearer <token>` header. The example nodes
  expose `token` as a ROS parameter; the Python runtime sends it as this
  header:
  ```python
  client = Proto4WebrtcProducer(signaling_url=..., token=os.environ["ROBOT_TOKEN"])
  ```
- **browser** — a cookie (ideally `HttpOnly`), sent automatically on the WS
  handshake. `connectToSfu()` / `useSfu()` take no token option.

Issuing tokens and cookies (login pages, OAuth flows, session exchange) is the
application's job. See [`example/`](example/README.md) for a worked HS256-JWT
resolver (`server/src/lib/proto4webrtc/auth.ts`).

Enforcement is split by trust root. Stream protection is enforced at the SFU:
only robot-role peers may produce streams, the generated producers stamp
`protected` into the producer's `appData`, and guests are denied
`consume`/`consumeData` on it. Rpc method protection is enforced on the
robot: the SFU stamps each browser's resolved role into the appData of its
`<label>/requests` channel (client-supplied `role`/`protected` appData is
stripped), and the generated service base rejects guests calling `protected`
methods with a "permission denied" rpc error. The robot never sees or
verifies tokens.

## Choosing a video codec

`video_codec` on a `media_stream` pins the codec that stream is sent with.
The generated producer carries it as `VIDEO_CODEC` and passes the matching
negotiated capability to mediasoup's `produce()`, so the annotation alone
decides what goes on the wire — the default router config declares VP8, VP9,
H264 and Opus, so nothing needs configuring SFU-side. Leaving it unset means
"the router's preferred codec for this kind" (VP8 today, being first in the
default list). Mismatches fail loudly at connect time rather than silently
falling back.

### What the robot can actually encode

The Python producer runtime is aiortc, whose video codec set is fixed:

| Codec  | Python producer (aiortc)                                       | Browser producer | Notes                                                                       |
| ------ | -------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `VP8`  | ✅ libvpx, software                                            | ✅               | The safe default. Universally decodable, tolerant of packet loss.           |
| `H264` | ✅ libx264, software, constrained baseline, packetization-mode 1 | ✅               | Hardware decode almost everywhere (iOS/Safari, mobile SoCs). No B-frames.   |
| `VP9`  | ❌ not implemented                                             | ✅               | Only reachable when the _sender_ is a browser. A robot cannot produce it.   |

So on a robot the real choice is **VP8 or H264**.

### Which to pick

- **VP8 — default.** Pick it unless you have a specific reason not to. Every
  browser decodes it, error resilience is good on lossy links, and it is what
  an unset `video_codec` negotiates.
- **H264 — pick when clients are battery-powered or CPU-bound.** Decode is
  hardware-accelerated on essentially every phone, tablet and Mac, which
  matters for a 24/7 operator tablet or an iOS client. Better quality per bit
  than VP8 at the same bitrate, and the stream can be recorded/muxed straight
  into MP4 without transcoding. Costs: `libx264` encode on the robot is
  software (watch CPU on an SBC — an SoC hardware encoder is not used by
  aiortc), constrained baseline only, and H264 carries patent-licensing
  considerations VP8 does not.
- **VP9 — only for browser-sourced video** (e.g. an operator sharing a
  screen back). Better compression than both, at a markedly higher encode
  cost. Annotating a robot stream with it makes that process refuse to
  produce: `video_codec VP9 ... the Python producer runtime cannot encode`.

`kind: AUDIO` streams are Opus and reject `video_codec` at generation time.

### Declaring it

Nothing beyond the annotation:

```proto
message Camera {
  option (proto4webrtc.media_stream) = {
    label: "camera"
    kind: VIDEO
    video_codec: H264
  };
}
```

The generated producer class gets `VIDEO_CODEC = "H264"` and pins its
mediasoup producer to the negotiated `video/H264` capability — parameters
(`profile-level-id`, `packetization-mode`) come from the negotiation itself,
so there is nothing to keep in sync by hand.

Overriding `router.mediaCodecs` replaces the default list wholesale, so an
override must still contain every codec your streams declare, plus
`audio/opus` if you have audio streams:

```ts
const sfu = new Proto4WebrtcSfu({
  router: {
    mediaCodecs: [
      { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: {} },
      {
        kind: "video",
        mimeType: "video/H264",
        clockRate: 90000,
        parameters: {
          // Must match what aiortc/browsers offer, or H264 never negotiates:
          "packetization-mode": 1,
          "level-asymmetry-allowed": 1,
          "profile-level-id": "42e01f", // constrained baseline 3.1
        },
      },
      { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    ],
  },
});
```

Drop a codec a stream declares and that stream's producer raises on connect,
naming the stream, the codec, and what the SFU did offer — it does not
silently fall back to VP8.

## Options reference

| Option                | Applies to | Meaning                                                                                                               |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `label`               | both       | Unique mediasoup producer label; consumers select by it                                                               |
| `delivery`            | data       | `RELIABLE_ORDERED` (default; required for >64 KiB messages) or `UNRELIABLE`                                           |
| `backpressure`        | data       | `BUFFER_ALL` (default) or `DROP_IF_BUFFERED` (newest wins)                                                            |
| `max_buffered_factor` | data       | `DROP_IF_BUFFERED` threshold, in multiples of message size (default 2)                                                |
| `kind`                | media      | `VIDEO` or `AUDIO`                                                                                                    |
| `video_codec`         | media      | `VP8`, `VP9`, `H264`, or unset for the router's preferred codec. Video only; pins the producer's codec (see [Choosing a video codec](#choosing-a-video-codec)) |
| `label` (rpc)         | service    | Base channel label; `<label>/requests` and `<label>/responses` are derived and share the stream label namespace       |
| `protected`           | data/media | Admin-only stream: the SFU denies guests `consume`/`consumeData` (enforced only when the host passes non-robot roles) |
| `protected` (rpc)     | method     | Admin-only rpc method: the robot rejects guest callers (enforced only when the host passes non-robot roles)           |

The plugins never read `options.proto` at generation time — protoc compiles
annotations into the descriptors it hands them. The file only matters when
_authoring_ protofiles (BSR dep above, or the copy bundled in the pip
package).

The two languages are deliberately **asymmetric** here — get this backwards
and it breaks:

|            | `proto4webrtc/options_pb*` generated? | why                                                                                                                                                   |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python     | **no**                                | would shadow the `proto4webrtc` runtime package (below)                                                                                               |
| TypeScript | **yes**                               | protoc-gen-es emits `import ... from "../proto4webrtc/options_pb"` into every `*_pb.ts` that imports the options — exclude it and the typecheck fails |

So on the TS side let `buf generate` compile the options module along with
your protos (the default when the dep is in `buf.yaml`); don't filter it out.
On the Python side the driver filters it for you: even if the file sits in
your proto root (e.g. vendored by `buf export`) it is used as an import only,
never a `--python_out` target. Restricting the compile set with `--include
'yourpkg/*.proto'` also works, but is no longer required for this.

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
