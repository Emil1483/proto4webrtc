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
//     client.onProducerClosed((label) => { ... });
//     client.close();

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Device } from "mediasoup-client";
import type { types } from "mediasoup-client";

import {
  RpcRequestSchema,
  RpcResponseSchema,
} from "./gen/proto4webrtc/rpc_pb.js";

/** Receive transport connection state (mediasoup-client's ConnectionState). */
export type ConnectionState = types.ConnectionState;

export interface Proto4WebrtcClientOptions {
  /** Signaling WebSocket URL. Default: ws(s)://<location.host>/api/sfu */
  url?: string;
  /**
   * The browser WebSocket API can't set request headers, so there is no token
   * option here: authenticate the signaling connection with a cookie instead.
   * A same-origin cookie (ideally HttpOnly) is sent automatically on the WS
   * handshake, where the host app reads it, resolves a Role, and passes it to
   * the SFU. With no auth configured every peer is a robot (full access).
   */
  onConnectionState?: (state: ConnectionState) => void;
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
  // producerId/dataProducerId -> label, so close events (which only carry the
  // id) can be reported per label. Media producers carry theirs in appData.
  private producerLabels = new Map<string, string | undefined>();
  private device = new Device();
  private recvTransport!: types.Transport;
  private onConnectionState?: (state: ConnectionState) => void;

  private constructor(url: string, onConnectionState?: (state: ConnectionState) => void) {
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
        this.trackLabel(msg);
        for (const handler of this.eventHandlers) handler(msg);
        if (msg.event === "producerClosed" || msg.event === "dataProducerClosed")
          this.producerLabels.delete(
            (msg.producerId ?? msg.dataProducerId) as string,
          );
      }
    };
  }

  private trackLabel(msg: Envelope): void {
    if (msg.event === "newProducer") {
      const appData = msg.appData as { label?: string } | undefined;
      this.producerLabels.set(msg.producerId as string, appData?.label);
    } else if (msg.event === "newDataProducer") {
      this.producerLabels.set(
        msg.dataProducerId as string,
        msg.label as string | undefined,
      );
    }
  }

  /** Connect, load the Device, and create the receive transport. */
  static async connect(
    options: Proto4WebrtcClientOptions = {},
  ): Promise<Proto4WebrtcClient> {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = options.url ?? `${proto}://${window.location.host}/api/sfu`;
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

    // Seed the id->label map with producers already online, so a close event
    // can be reported per label even for producers no stream subscribed to.
    client
      .request<{
        producers: { producerId: string; appData?: { label?: string } }[];
        dataProducers: { dataProducerId: string; label?: string }[];
      }>("getProducers")
      .then((list) => {
        for (const p of list.producers)
          client.producerLabels.set(p.producerId, p.appData?.label);
        for (const dp of list.dataProducers)
          client.producerLabels.set(dp.dataProducerId, dp.label);
      })
      .catch(() => {});
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

  // --- rpc ------------------------------------------------------------------

  private clientId = Math.random().toString(36).slice(2, 12);
  private nextRpcId = 1n;
  private rpcPending = new Map<
    bigint,
    {
      resolve: (payload: Uint8Array) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sendTransportPromise?: Promise<types.Transport>;
  private requestProducers = new Map<string, Promise<types.DataProducer>>();
  private rpcSubscribed = new Set<string>();

  /**
   * One unary rpc call, raw payload in/out — the generated typed
   * client.rpc.<method>() wrappers call this. Sends a proto4webrtc.RpcRequest
   * on "<label>/requests" (produced lazily, once per service) and resolves
   * with the matching RpcResponse payload from "<label>/responses".
   */
  async callRpc(
    label: string,
    method: string,
    payload: Uint8Array,
    options?: { timeoutMs?: number },
  ): Promise<Uint8Array> {
    this.subscribeRpcResponses(label);
    const producer = await this.getRequestProducer(label);
    const id = this.nextRpcId++;
    const bytes = toBinary(
      RpcRequestSchema,
      create(RpcRequestSchema, {
        clientId: this.clientId,
        id,
        method,
        payload,
      }),
    );
    return new Promise<Uint8Array>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        this.rpcPending.delete(id);
        reject(new Error(`rpc ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.rpcPending.set(id, { resolve, reject, timer });
      try {
        producer.send(bytes);
      } catch (err) {
        clearTimeout(timer);
        this.rpcPending.delete(id);
        throw err;
      }
    });
  }

  private subscribeRpcResponses(label: string): void {
    if (this.rpcSubscribed.has(label)) return;
    this.rpcSubscribed.add(label);
    this.subscribe(`${label}/responses`, (data) => {
      const res = fromBinary(RpcResponseSchema, data);
      if (res.clientId !== this.clientId) return; // some other browser's call
      const pending = this.rpcPending.get(res.id);
      if (!pending) return;
      this.rpcPending.delete(res.id);
      clearTimeout(pending.timer);
      if (res.error) pending.reject(new Error(res.error));
      else pending.resolve(res.payload);
    });
  }

  private getRequestProducer(label: string): Promise<types.DataProducer> {
    let producer = this.requestProducers.get(label);
    if (!producer) {
      producer = (async () => {
        const transport = await this.getSendTransport();
        const dataProducer = await transport.produceData({
          label: `${label}/requests`,
          ordered: true,
        });
        if (dataProducer.readyState !== "open") {
          await new Promise<void>((resolve, reject) => {
            dataProducer.on("open", resolve);
            dataProducer.on("close", () =>
              reject(new Error("request channel closed before opening")),
            );
          });
        }
        return dataProducer;
      })();
      this.requestProducers.set(label, producer);
      producer.catch(() => this.requestProducers.delete(label));
    }
    return producer;
  }

  private getSendTransport(): Promise<types.Transport> {
    if (!this.sendTransportPromise) {
      this.sendTransportPromise = (async () => {
        const params = await this.request<
          types.TransportOptions & { iceServers?: RTCIceServer[] }
        >("createTransport", { direction: "send" });
        const transport = this.device.createSendTransport(params);
        transport.on("connect", ({ dtlsParameters }, cb, errback) => {
          this.request("connectTransport", {
            transportId: transport.id,
            dtlsParameters,
          })
            .then(() => cb())
            .catch(errback);
        });
        transport.on(
          "producedata",
          ({ sctpStreamParameters, label, protocol, appData }, cb, errback) => {
            this.request<{ id: string }>("produceData", {
              transportId: transport.id,
              sctpStreamParameters,
              label,
              protocol,
              appData: appData ?? {},
            })
              .then(({ id }) => cb({ id }))
              .catch(errback);
          },
        );
        return transport;
      })();
    }
    return this.sendTransportPromise;
  }

  /** Fires whenever any producer or data producer appears or goes away. */
  onProducersChanged(cb: () => void): () => void {
    const handler = (msg: Envelope) => {
      if (
        msg.event === "newProducer" ||
        msg.event === "newDataProducer" ||
        msg.event === "producerClosed" ||
        msg.event === "dataProducerClosed"
      )
        cb();
    };
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Fires whenever any producer or data producer goes away, with the closed
   * producer's label (undefined if it was never seen — e.g. a media producer
   * without a label in appData, or a race right after connecting). With
   * multiple robot processes behind one SFU, filter by label to track each
   * process's liveness independently; rpc request channels from other
   * browsers show up as "<service label>/requests".
   */
  onProducerClosed(cb: (label?: string) => void): () => void {
    const handler = (msg: Envelope) => {
      if (msg.event === "producerClosed" || msg.event === "dataProducerClosed") {
        const id = (msg.producerId ?? msg.dataProducerId) as string;
        cb(this.producerLabels.get(id));
      }
    };
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  close(): void {
    for (const pending of this.rpcPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("client closed"));
    }
    this.rpcPending.clear();
    void this.sendTransportPromise?.then((t) => t.close()).catch(() => {});
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
