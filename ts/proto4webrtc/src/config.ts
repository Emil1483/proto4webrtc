// Default mediasoup Worker/Router/WebRtcTransport settings, ported from
// web-rtc-test/server's config.ts minus its env-var reading (an app
// concern — this library takes final resolved values).

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

const RTC_MIN_PORT = 40000;
const RTC_MAX_PORT = 40049;

export const defaultConfig: Required<Proto4WebrtcSfuConfig> = {
  worker: {
    rtcMinPort: RTC_MIN_PORT,
    rtcMaxPort: RTC_MAX_PORT,
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
      {
        protocol: "udp",
        ip: "0.0.0.0",
        portRange: { min: RTC_MIN_PORT, max: RTC_MAX_PORT },
      },
      {
        protocol: "tcp",
        ip: "0.0.0.0",
        portRange: { min: RTC_MIN_PORT, max: RTC_MAX_PORT },
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    enableSctp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  },

  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Shallow, per-section merge — overriding a section means repeating any
// nested fields (e.g. listenInfos) you still want from the default.
export function resolveConfig(config?: Proto4WebrtcSfuConfig): Required<Proto4WebrtcSfuConfig> {
  return {
    worker: { ...defaultConfig.worker, ...config?.worker },
    router: { ...defaultConfig.router, ...config?.router },
    // Spreading two values of a discriminated union erases the "exactly one
    // variant" shape as far as the type-checker can tell, even though at
    // runtime an override (a complete, valid options object per its own type)
    // spread over the default produces another valid one.
    webRtcTransport: {
      ...defaultConfig.webRtcTransport,
      ...config?.webRtcTransport,
    } as types.WebRtcTransportOptions,
    iceServers: config?.iceServers ?? defaultConfig.iceServers,
  };
}
