# proto4webrtc (TypeScript SFU runtime)

Runs the mediasoup SFU side: signaling, Worker/Router/transport lifecycle,
and in-process access to a data stream by label — no browser, no WebRTC. The
codegen counterpart is the npm package `protoc-gen-proto4webrtc-ts`, which
generates a typed `subscribe()`/`attach()`/`decode()` wrapper per stream.

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

`iceServers` defaults to a public STUN server. `sfu.getIceServers()` returns
the resolved list — hand it to browser consumers however your app already
exposes server-only config to the client (e.g. a Next.js Server Action),
since it can include TURN credentials:

```ts
export async function getIceServers() {
  "use server";
  return sfu.getIceServers();
}
```

Full docs: https://github.com/Emil1483/proto4webrtc
