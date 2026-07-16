// mediasoup SFU singleton. Signaling, the Worker/Router/transport lifecycle,
// reconnect-tolerant producer/dataProducer registries, and ICE server config
// are all handled by Proto4WebrtcSfu (npm package "proto4webrtc"). This
// module only supplies the env-driven parts that differ per deployment.
//
// Env:
//   MEDIASOUP_LISTEN_IP      bind address inside the container/host (default 0.0.0.0)
//   MEDIASOUP_ANNOUNCED_IP   public address peers connect to (falls back to PUBLIC_IP)
//   MEDIASOUP_RTC_MIN_PORT   RTC UDP/TCP port range start (default 40000)
//   MEDIASOUP_RTC_MAX_PORT   RTC UDP/TCP port range end   (default 40049)
//   TURN_URLS                comma-separated TURN urls, e.g.
//                            "turn:1.2.3.4:3478?transport=udp,turn:1.2.3.4:3478?transport=tcp"
//   TURN_USERNAME            TURN username
//   TURN_CREDENTIAL          TURN password
//
// The RTC port range must be published in compose and opened in the
// firewall. Router media codecs (VP8) are left at Proto4WebrtcSfu's default.
// If TURN_URLS is unset, iceServers is also left at its default (STUN only).

import { Proto4WebrtcSfu } from "proto4webrtc";

const LISTEN_IP = process.env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0";
const ANNOUNCED_ADDRESS =
  process.env.MEDIASOUP_ANNOUNCED_IP ?? process.env.PUBLIC_IP ?? undefined;
const RTC_MIN_PORT = Number(process.env.MEDIASOUP_RTC_MIN_PORT ?? 40000);
const RTC_MAX_PORT = Number(process.env.MEDIASOUP_RTC_MAX_PORT ?? 40049);

const TURN_URLS = (process.env.TURN_URLS ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

export const sfu = new Proto4WebrtcSfu({
  // Both UDP and TCP: TCP is the fallback for clients on UDP-hostile
  // networks, avoiding a TURN relay requirement.
  webRtcTransport: {
    listenInfos: [
      {
        protocol: "udp",
        ip: LISTEN_IP,
        announcedAddress: ANNOUNCED_ADDRESS,
        portRange: { min: RTC_MIN_PORT, max: RTC_MAX_PORT },
      },
      {
        protocol: "tcp",
        ip: LISTEN_IP,
        announcedAddress: ANNOUNCED_ADDRESS,
        portRange: { min: RTC_MIN_PORT, max: RTC_MAX_PORT },
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    enableSctp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  },
  ...(TURN_URLS.length > 0 && {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      ...TURN_URLS.map((urls) => ({
        urls,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      })),
    ],
  }),
});
