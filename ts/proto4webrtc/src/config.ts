// Default mediasoup Worker/Router/WebRtcTransport settings.
//
// The defaults are env-driven so `new Proto4WebrtcSfu()` works out of the
// box, locally and deployed, without any code-level config:
//
//   MEDIASOUP_LISTEN_IP      bind address (default 0.0.0.0)
//   MEDIASOUP_ANNOUNCED_IP   public address peers connect to (falls back to
//                            PUBLIC_IP, then to the machine's first
//                            non-internal IPv4, auto-detected)
//   MEDIASOUP_RTC_MIN_PORT   RTC UDP/TCP port range start (default 40000)
//   MEDIASOUP_RTC_MAX_PORT   RTC UDP/TCP port range end   (default 40049)
//   TURN_URLS                comma-separated TURN urls appended to the STUN
//                            default, e.g. "turn:1.2.3.4:3478?transport=udp"
//   TURN_USERNAME            TURN username
//   TURN_CREDENTIAL          TURN password
//
// Explicit Proto4WebrtcSfuConfig values override the env-derived defaults
// per top-level section.

import os from "node:os";

import type { types } from "mediasoup";

export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface Proto4WebrtcSfuConfig {
  worker?: Partial<types.WorkerSettings>;
  router?: { mediaCodecs?: types.RouterRtpCodecCapability[] };
  // Not Partial<>: WebRtcTransportOptions is a discriminated union (listenInfos
  // vs listenIps vs webRtcServer) that Partial<> can't meaningfully wrap.
  // Overriding this section means supplying a complete, valid options object.
  webRtcTransport?: types.WebRtcTransportOptions;
  // Given to browser consumers for the RTCPeerConnection (STUN + optional
  // TURN). Replaces the default wholesale, same as webRtcTransport — include
  // a STUN entry too if you still want one alongside your own TURN servers.
  iceServers?: IceServer[];
}

// Exported for tests; apps normally rely on the module-level `defaultConfig`
// built from process.env at import time.
export function buildDefaultConfig(
  env: Record<string, string | undefined>,
): Required<Proto4WebrtcSfuConfig> {
  const listenIp = env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0";
  const announcedAddress =
    env.MEDIASOUP_ANNOUNCED_IP ?? env.PUBLIC_IP ?? undefined;
  const rtcMinPort = Number(env.MEDIASOUP_RTC_MIN_PORT ?? 40000);
  const rtcMaxPort = Number(env.MEDIASOUP_RTC_MAX_PORT ?? 40049);
  const portRange = { min: rtcMinPort, max: rtcMaxPort };

  const turnUrls = (env.TURN_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  return {
    worker: {
      rtcMinPort,
      rtcMaxPort,
      logLevel: "warn",
      logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
    },

    router: {
      mediaCodecs: [
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {},
        },
      ],
    },

    // Both UDP and TCP: TCP is the fallback for clients on UDP-hostile
    // networks, avoiding a TURN relay requirement.
    webRtcTransport: {
      listenInfos: [
        { protocol: "udp", ip: listenIp, announcedAddress, portRange },
        { protocol: "tcp", ip: listenIp, announcedAddress, portRange },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      enableSctp: true,
      initialAvailableOutgoingBitrate: 1_000_000,
    },

    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      ...turnUrls.map((urls) => ({
        urls,
        username: env.TURN_USERNAME,
        credential: env.TURN_CREDENTIAL,
      })),
    ],
  };
}

export const defaultConfig: Required<Proto4WebrtcSfuConfig> =
  buildDefaultConfig(process.env);

// First non-internal IPv4, falling back to loopback. Used as the announced
// address for wildcard listens: mediasoup puts the listen ip verbatim into
// the ICE candidates, and a candidate of "0.0.0.0" is unreachable for every
// peer.
function detectAnnouncedAddress(): string {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (!info.internal && info.family === "IPv4") return info.address;
    }
  }
  return "127.0.0.1";
}

function withAnnouncedAddress(
  transport: types.WebRtcTransportOptions,
): types.WebRtcTransportOptions {
  if (!("listenInfos" in transport) || !transport.listenInfos) return transport;
  return {
    ...transport,
    listenInfos: transport.listenInfos.map((info) =>
      (info.ip === "0.0.0.0" || info.ip === "::") && !info.announcedAddress
        ? { ...info, announcedAddress: detectAnnouncedAddress() }
        : info,
    ),
  };
}

// Shallow, per-section merge — overriding a section means repeating any
// nested fields (e.g. listenInfos) you still want from the default.
// Wildcard listenInfos (0.0.0.0/::) without an announcedAddress get the
// machine's first non-internal IPv4 announced automatically.
export function resolveConfig(config?: Proto4WebrtcSfuConfig): Required<Proto4WebrtcSfuConfig> {
  return {
    worker: { ...defaultConfig.worker, ...config?.worker },
    router: { ...defaultConfig.router, ...config?.router },
    // Spreading two values of a discriminated union erases the "exactly one
    // variant" shape as far as the type-checker can tell, even though at
    // runtime an override (a complete, valid options object per its own type)
    // spread over the default produces another valid one.
    webRtcTransport: withAnnouncedAddress({
      ...defaultConfig.webRtcTransport,
      ...config?.webRtcTransport,
    } as types.WebRtcTransportOptions),
    iceServers: config?.iceServers ?? defaultConfig.iceServers,
  };
}
