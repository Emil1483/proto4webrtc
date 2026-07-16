// Browser consumer client for a Proto4WebrtcSfu signaling endpoint.
// Import from "proto4webrtc/client" (browser-only entry: uses WebSocket,
// mediasoup-client and DOM types; the root "proto4webrtc" entry stays
// Node-only).
//
// One call does all the setup every viewer page needs — ICE config (served by
// the SFU in the createTransport reply), Device load, receive transport:
//
//     const client = await connectToSfu({ onConnectionState: setState });
//
// then subscribe to streams, existing and future producers alike:
//
//     client.subscribe("telemetry", (data) => { ... });        // raw bytes
//     TelemetryStream.subscribe(client, (msg) => { ... });     // typed (generated)
//     CameraStream.subscribe(client, (track) => { ... });      // media track
//     client.onProducerClosed(() => { ... });
//     client.close();

import { Device } from "mediasoup-client";
import type { types } from "mediasoup-client";

export interface Proto4WebrtcClientOptions {
  /** Signaling WebSocket URL. Default: ws(s)://<location.host>/api/sfu */
  url?: string;
  onConnectionState?: (state: string) => void;
}

interface Envelope {
  id?: number;
  ok?: boolean;
  data?: unknown;
  error?: string;
  event?: string;
  [key: string]: unknown;
}

export class Proto4WebrtcClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private eventHandlers = new Set<(msg: Envelope) => void>();
  private device = new Device();
  private recvTransport!: types.Transport;
  private onConnectionState?: (state: string) => void;

  private constructor(url: string, onConnectionState?: (state: string) => void) {
    this.onConnectionState = onConnectionState;
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const msg: Envelope = JSON.parse(String(e.data));
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error ?? "rpc error"));
      } else if (msg.event) {
        for (const handler of this.eventHandlers) handler(msg);
      }
    };
  }

  /** Connect, load the Device, and create the receive transport. */
  static async connect(
    options: Proto4WebrtcClientOptions = {},
  ): Promise<Proto4WebrtcClient> {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url =
      options.url ?? `${proto}://${window.location.host}/api/sfu`;
    const client = new Proto4WebrtcClient(url, options.onConnectionState);
    await new Promise<void>((resolve, reject) => {
      client.ws.onopen = () => resolve();
      client.ws.onerror = () => reject(new Error("ws error"));
    });

    const routerRtpCapabilities =
      await client.request<types.RtpCapabilities>("getRtpCapabilities");
    await client.device.load({ routerRtpCapabilities });

    // The reply includes the SFU's ICE config (STUN + optional TURN), which
    // mediasoup-client accepts directly as a transport option.
    const params = await client.request<
      types.TransportOptions & { iceServers?: RTCIceServer[] }
    >("createTransport", { direction: "recv" });
    client.recvTransport = client.device.createRecvTransport(params);

    client.recvTransport.on("connect", ({ dtlsParameters }, cb, errback) => {
      client
        .request("connectTransport", {
          transportId: client.recvTransport.id,
          dtlsParameters,
        })
        .then(() => cb())
        .catch(errback);
    });
    client.recvTransport.on("connectionstatechange", (state) =>
      client.onConnectionState?.(state),
    );
    return client;
  }

  /** Low-level signaling RPC, for actions without a dedicated helper. */
  request<T = unknown>(action: string, params: object = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, action, ...params }));
    });
  }

  /**
   * Every message on the labeled data stream into the callback — covers the
   * producer already online at call time and any that (re)appears later.
   * Same shape as Proto4WebrtcSfu.subscribe(), so the generated typed
   * streams' subscribe() accepts either.
   */
  subscribe(
    label: string,
    onMessage: (data: Uint8Array) => void,
  ): () => void {
    const consume = async (dataProducerId: string) => {
      const params = await this.request<{
        id: string;
        dataProducerId: string;
        sctpStreamParameters: types.SctpStreamParameters;
        label: string;
        protocol: string;
      }>("consumeData", {
        transportId: this.recvTransport.id,
        dataProducerId,
      });
      const dataConsumer = await this.recvTransport.consumeData(params);
      dataConsumer.on("message", (data: ArrayBuffer) =>
        onMessage(new Uint8Array(data)),
      );
    };
    return this.watch(
      (msg) =>
        msg.event === "newDataProducer" && msg.label === label
          ? (msg.dataProducerId as string)
          : undefined,
      (list) =>
        list.dataProducers
          .filter((dp) => dp.label === label)
          .map((dp) => dp.dataProducerId),
      consume,
    );
  }

  /**
   * The labeled media stream's track into the callback — covers the producer
   * already online at call time and any that (re)appears later. The consumer
   * is created paused server-side and resumed once wired up here.
   */
  onMedia(
    kind: string,
    onTrack: (track: MediaStreamTrack) => void,
  ): () => void {
    const consume = async (producerId: string) => {
      const params = await this.request<{
        id: string;
        producerId: string;
        kind: types.MediaKind;
        rtpParameters: types.RtpParameters;
      }>("consume", {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      });
      const consumer = await this.recvTransport.consume(params);
      await this.request("resumeConsumer", { consumerId: consumer.id });
      onTrack(consumer.track);
    };
    return this.watch(
      (msg) =>
        msg.event === "newProducer" && msg.kind === kind
          ? (msg.producerId as string)
          : undefined,
      (list) =>
        list.producers
          .filter((p) => p.kind === kind)
          .map((p) => p.producerId),
      consume,
    );
  }

  /** Fires whenever any producer or data producer goes away. */
  onProducerClosed(cb: () => void): () => void {
    const handler = (msg: Envelope) => {
      if (msg.event === "producerClosed" || msg.event === "dataProducerClosed")
        cb();
    };
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  close(): void {
    this.recvTransport?.close();
    this.ws.close();
  }

  // Shared existing-plus-future producer watcher: replay matches from
  // getProducers, then keep consuming matches from pushed events.
  private watch(
    matchEvent: (msg: Envelope) => string | undefined,
    matchExisting: (list: {
      producers: { producerId: string; kind: string }[];
      dataProducers: { dataProducerId: string; label: string }[];
    }) => string[],
    consume: (id: string) => Promise<void>,
  ): () => void {
    const seen = new Set<string>();
    const take = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      consume(id).catch((err) =>
        console.error("[proto4webrtc] consume failed:", err),
      );
    };
    const handler = (msg: Envelope) => {
      const id = matchEvent(msg);
      if (id !== undefined) take(id);
    };
    this.eventHandlers.add(handler);
    this.request<Parameters<typeof matchExisting>[0]>("getProducers")
      .then((list) => matchExisting(list).forEach(take))
      .catch((err) =>
        console.error("[proto4webrtc] getProducers failed:", err),
      );
    return () => this.eventHandlers.delete(handler);
  }
}

/** Connect to the SFU signaling endpoint. See Proto4WebrtcClient. */
export function connectToSfu(
  options: Proto4WebrtcClientOptions = {},
): Promise<Proto4WebrtcClient> {
  return Proto4WebrtcClient.connect(options);
}
