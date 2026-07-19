// mediasoup signaling endpoint (next-ws). One WebSocket per peer (robot or
// browser). Proto4WebrtcSfu (npm package "proto4webrtc") owns the request/
// response protocol and lazily connects the Worker/Router on first use.

import { resolveRole } from "@/lib/proto4webrtc/auth";
import { sfu } from "@/lib/proto4webrtc/sfu";

export function UPGRADE(
  client: import("ws").WebSocket,
  server: import("ws").WebSocketServer,
  request: import("next/server").NextRequest,
) {
  // The SFU doesn't authenticate — we do, then hand it a Role. The token
  // rides an Authorization header (robot) or a cookie (browser), never the
  // URL. undefined means a supplied token failed to verify: reject.
  let role;
  try {
    role = resolveRole(request.headers);
  } catch (err) {
    // Auth env vars missing — fail loud, don't silently allow everyone.
    console.error("[sfu]", err instanceof Error ? err.message : err);
    client.close(4500, "server auth misconfigured");
    return;
  }
  if (role === undefined) {
    console.warn("[sfu] rejecting peer: invalid token");
    client.close(4401, "invalid token");
    return;
  }
  console.log("[sfu] peer connected with role", role);
  sfu.handleWSClient(client, role);
  client.on("close", () => console.log("[sfu] peer disconnected"));
}

export function GET() {
  return new Response("mediasoup signaling endpoint. Connect via WebSocket.", {
    status: 426,
    statusText: "Upgrade Required",
  });
}
