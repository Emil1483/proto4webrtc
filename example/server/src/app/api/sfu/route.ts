// mediasoup signaling endpoint (next-ws). One WebSocket per peer (robot or
// browser). Proto4WebrtcSfu (npm package "proto4webrtc") owns the request/
// response protocol and lazily connects the Worker/Router on first use.

import { sfu } from "@/lib/proto4webrtc/sfu";

export function UPGRADE(
  client: import("ws").WebSocket,
  server: import("ws").WebSocketServer,
  request: import("next/server").NextRequest,
) {
  console.log("[sfu] peer connected");
  // request.url carries the peer's ?token=; the SFU verifies it and derives
  // the peer's role (no token -> guest when auth is enabled).
  sfu.handleWSClient(client, request.url);
  client.on("close", () => console.log("[sfu] peer disconnected"));
}

export function GET() {
  return new Response("mediasoup signaling endpoint. Connect via WebSocket.", {
    status: 426,
    statusText: "Upgrade Required",
  });
}
