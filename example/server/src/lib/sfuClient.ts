// Browser-side helpers for the mediasoup SFU, shared by every viewer page.
//
// Signaling is the {id, action, ...} -> {id, ok, data} RPC over the /api/sfu
// WebSocket, plus server-pushed events (newProducer, producerClosed, ...).
// connectToSfu() does the setup every page needs: ICE config, Device load,
// receive transport. Pages then consume only the producers their screen needs.

import { Device } from "mediasoup-client";
import type { types } from "mediasoup-client";
import { getIceServers } from "@/lib/webrtc/iceServers";

export class Signaling {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  onEvent: (msg: Record<string, unknown>) => void = () => {};

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error ?? "rpc error"));
      } else if (msg.event) {
        this.onEvent(msg);
      }
    };
  }

  ready(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error("ws error"));
    });
  }

  request<T = unknown>(action: string, params: object = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, action, ...params }));
    });
  }

  close() {
    this.ws.close();
  }
}

export interface SfuConnection {
  signaling: Signaling;
  device: Device;
  recvTransport: types.Transport;
}

export interface ProducerList {
  producers: { producerId: string; kind: string }[];
  dataProducers: { dataProducerId: string; label: string }[];
}

export async function connectToSfu(
  onConnectionState: (state: string) => void,
): Promise<SfuConnection> {
  // ICE servers (STUN + optional TURN) for the transport.
  let iceServers: RTCIceServer[] = [];
  try {
    iceServers = await getIceServers();
  } catch {
    /* direct only */
  }

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const signaling = new Signaling(`${proto}://${window.location.host}/api/sfu`);
  await signaling.ready();

  const device = new Device();
  const routerRtpCapabilities = await signaling.request<types.RtpCapabilities>(
    "getRtpCapabilities",
  );
  await device.load({ routerRtpCapabilities });

  const params = await signaling.request<types.TransportOptions>(
    "createTransport",
    { direction: "recv" },
  );
  const recvTransport = device.createRecvTransport({ ...params, iceServers });

  recvTransport.on("connect", ({ dtlsParameters }, cb, errback) => {
    signaling
      .request("connectTransport", {
        transportId: recvTransport.id,
        dtlsParameters,
      })
      .then(() => cb())
      .catch(errback);
  });
  recvTransport.on("connectionstatechange", onConnectionState);

  return { signaling, device, recvTransport };
}

// Consume a video producer; returns the consumer with its track flowing
// (created paused server-side, resumed once wired up here).
export async function consumeVideo(
  conn: SfuConnection,
  producerId: string,
): Promise<types.Consumer> {
  const p = await conn.signaling.request<{
    id: string;
    producerId: string;
    kind: types.MediaKind;
    rtpParameters: types.RtpParameters;
  }>("consume", {
    transportId: conn.recvTransport.id,
    producerId,
    rtpCapabilities: conn.device.rtpCapabilities,
  });
  const consumer = await conn.recvTransport.consume(p);
  await conn.signaling.request("resumeConsumer", { consumerId: consumer.id });
  return consumer;
}

export async function consumeData(
  conn: SfuConnection,
  dataProducerId: string,
): Promise<types.DataConsumer> {
  const p = await conn.signaling.request<{
    id: string;
    dataProducerId: string;
    sctpStreamParameters: types.SctpStreamParameters;
    label: string;
    protocol: string;
  }>("consumeData", { transportId: conn.recvTransport.id, dataProducerId });
  return conn.recvTransport.consumeData(p);
}
