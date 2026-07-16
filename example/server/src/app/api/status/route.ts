// Health/status of the mediasoup SFU: router ready, peer/producer counts.

import { sfu } from "@/lib/proto4webrtc/sfu";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(sfu.getStatus());
}
