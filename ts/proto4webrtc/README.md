# proto4webrtc (TypeScript runtime)

Two entry points:

- `proto4webrtc` — the mediasoup SFU side (Node): signaling,
  Worker/Router/transport lifecycle, and in-process access to a data stream
  by label — no browser, no WebRTC.
- `proto4webrtc/client` — the browser consumer: one call for signaling,
  Device load, receive transport, and ICE config, plus
  existing-and-future-producer subscriptions per stream.

The codegen counterpart is the npm package `protoc-gen-proto4webrtc-ts`,
which generates typed wrappers per stream on top of both.

```sh
npm install proto4webrtc
```

```ts
import { Proto4WebrtcSfu } from "proto4webrtc";
import { TelemetryStream } from "./gen/proto4webrtc"; // generated, per project

const sfu = new Proto4WebrtcSfu(); // sane defaults; every field overridable

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

Real WebRTC media/video consumption is unchanged — browsers still connect to
`handleWSClient`'s signaling endpoint with real `mediasoup-client`.
`subscribe()` is the new capability: an app process gets data-stream
messages directly, via a mediasoup `DirectTransport` (no ICE/DTLS). It's
safe to call before the matching producer connects, and keeps working across
producer reconnects.

`connectToSfu()` explicitly warms up the Worker/Router; both
`handleWSClient()` and `subscribe()` do this internally too, so call order
never matters.

Config is merged shallowly, per top-level section (`worker`/`router`/
`webRtcTransport`/`iceServers`) — overriding a section means repeating any
nested fields (e.g. `listenInfos`) you still want from the default:

```ts
const sfu = new Proto4WebrtcSfu({
  webRtcTransport: {
    listenInfos: [{ protocol: "udp", ip: "0.0.0.0", announcedAddress: process.env.PUBLIC_IP }],
    enableUdp: true,
  },
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: process.env.TURN_URL!, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL },
  ],
});
```

`iceServers` defaults to a public STUN server. The resolved list is served
to browser consumers automatically in the `createTransport` signaling reply
(anyone who can reach the signaling endpoint gets it, TURN credentials
included — scope credentials accordingly). `sfu.getIceServers()` returns the
same list for manual wiring.

## Browser consumer (`proto4webrtc/client`)

Prefer the generated `connectToSfu()` from `protoc-gen-proto4webrtc-ts`
output — it returns this client extended with a typed
`subscribeTo<Stream>()` method per stream. The raw client underneath:

```ts
import { connectToSfu } from "proto4webrtc/client";

const client = await connectToSfu({
  url: "ws://localhost:3000/api/sfu", // default: ws(s)://<location.host>/api/sfu
  onConnectionState: (state) => console.log(state),
});

const stop = client.subscribe("telemetry", (data) => { /* raw Uint8Array */ });
client.onMedia("video", (track) => { videoEl.srcObject = new MediaStream([track]); });
client.onProducerClosed(() => { /* a producer went away */ });
client.close();
```

`subscribe()`/`onMedia()` cover the producer already online at call time and
any that (re)appears later, and create consumers only for what was asked —
the SFU never sends this peer unrequested streams.

Full docs: https://github.com/Emil1483/proto4webrtc
