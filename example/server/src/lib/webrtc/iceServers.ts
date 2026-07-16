"use server";

// Server Action: browser peers fetch ICE config this way instead of a public
// API route, since it may include TURN credentials. List construction (STUN
// default, TURN entries) lives in Proto4WebrtcSfu (npm package
// "proto4webrtc") — this file only exists because Next.js requires Server
// Actions to live in a file that isn't also imported by a Client Component
// for a plain (non-action) export, which @/lib/mediasoup/sfu is (the `sfu`
// singleton itself).

import { sfu } from "@/lib/mediasoup/sfu";

export async function getIceServers() {
  return sfu.getIceServers();
}
