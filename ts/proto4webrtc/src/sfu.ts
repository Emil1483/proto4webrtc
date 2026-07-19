// One Worker + one Router (a single "room"). Producers (robots) and
// consumers (browsers) connect over a signaling WebSocket handled by
// handleWSClient(); subscribe() gives server-side app code direct,
// in-process access to a data stream by label — no browser, no WebRTC.

import { EventEmitter } from "node:events";
import * as mediasoup from "mediasoup";
import type { types } from "mediasoup";
import type { WebSocket } from "ws";

import { resolveConfig, type IceServer, type Proto4WebrtcSfuConfig } from "./config.js";
import { PeerConnection } from "./peer.js";
import { Role } from "./roles.js";

export { Role };
export type { IceServer, Proto4WebrtcSfuConfig };

export interface Proto4WebrtcSfuStatus {
  ready: boolean;
  peers: number;
  producers: number;
  dataProducers: number;
}

export class Proto4WebrtcSfu {
  readonly config: ReturnType<typeof resolveConfig>;

  // Shared registries so any peer can consume any producer (selective subscribe).
  readonly producers = new Map<string, types.Producer>();
  readonly dataProducers = new Map<string, types.DataProducer>();
  readonly peers = new Set<PeerConnection>();

  /** Internal only — emits "dataProducer" on every produceData(); subscribe() listens here. */
  readonly events = new EventEmitter();

  private worker?: types.Worker;
  private _router?: types.Router;
  private initPromise?: Promise<types.Router>;
  private directTransportPromise?: Promise<types.DirectTransport>;

  constructor(config?: Proto4WebrtcSfuConfig) {
    this.config = resolveConfig(config);
    console.log(`[proto4webrtc] ${this.config.iceServers.length} ICE server(s) configured`);
  }

  get router(): types.Router {
    if (!this._router) throw new Error("Proto4WebrtcSfu: not connected yet — call connectToSfu() first");
    return this._router;
  }

  /** Idempotent: brings the Worker+Router up. Safe to call any number of times, in any order relative to handleWSClient()/subscribe() (both await it internally). */
  async connectToSfu(): Promise<void> {
    if (this._router) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.worker = await mediasoup.createWorker(this.config.worker as types.WorkerSettings);
        this.worker.on("died", () => {
          console.error("[proto4webrtc] mediasoup worker died — exiting");
          process.exit(1);
        });
        this._router = await this.worker.createRouter({
          mediaCodecs: this.config.router.mediaCodecs,
        });
        return this._router;
      })();
    }
    await this.initPromise;
  }

  /** ICE servers (STUN + optional TURN) for a browser consumer's RTCPeerConnection. */
  getIceServers(): IceServer[] {
    return this.config.iceServers;
  }

  getStatus(): Proto4WebrtcSfuStatus {
    return {
      ready: !!this._router,
      peers: this.peers.size,
      producers: this.producers.size,
      dataProducers: this.dataProducers.size,
    };
  }

  /**
   * Wire a raw `ws` WebSocket (e.g. next-ws's UPGRADE client) into the
   * signaling protocol.
   *
   * The SFU does not authenticate. The host application verifies the peer
   * however it likes (JWT, session cookie, mTLS, ...), maps the result to a
   * Role, and passes it here. Omitting `role` defaults to Role.ROBOT — every
   * peer gets full access, i.e. no-auth works out of the box. To enforce
   * access control, resolve a real role per peer and reject unauthenticated
   * connections before calling this (e.g. close the socket).
   */
  handleWSClient(client: WebSocket, role: Role = Role.ROBOT): void {
    const peer = new PeerConnection(this, client, role);
    client.on("message", (raw: unknown) => void peer.handle(raw));
    client.on("close", () => peer.close());
  }

  /**
   * Subscribe to a data stream by label, in-process — no websocket, no
   * browser, no WebRTC. Safe to call before the matching producer connects
   * (starts consuming as soon as it does) and survives producer reconnects
   * (a fresh dataProducer under the same label is picked up automatically).
   * Returns an unsubscribe function. Data streams only — a media-stream
   * label never fires, since produceData() is never called for one.
   */
  subscribe(label: string, onMessage: (data: Uint8Array) => void): () => void {
    let consumer: types.DataConsumer | undefined;
    let stopped = false;

    const tryConsume = async (dataProducer: types.DataProducer) => {
      if (stopped) return;
      await this.connectToSfu();
      const transport = await this.getDirectTransport();
      consumer = await transport.consumeData({ dataProducerId: dataProducer.id });
      consumer.on("message", (data: Uint8Array) => onMessage(data));
      consumer.on("dataproducerclose", () => {
        consumer = undefined;
      });
    };

    const existing = [...this.dataProducers.values()].find((p) => p.label === label);
    if (existing) void tryConsume(existing);

    const onNew = (dp: types.DataProducer) => {
      if (dp.label === label) void tryConsume(dp);
    };
    this.events.on("dataProducer", onNew);

    return () => {
      stopped = true;
      this.events.off("dataProducer", onNew);
      consumer?.close();
    };
  }

  private async getDirectTransport(): Promise<types.DirectTransport> {
    if (!this.directTransportPromise) {
      this.directTransportPromise = (async () => {
        await this.connectToSfu();
        return this.router.createDirectTransport();
      })();
    }
    return this.directTransportPromise;
  }

  /** Shut down the Worker (and everything under it). Mainly for tests/scripts — a long-lived server process typically never calls this. */
  close(): void {
    this.worker?.close();
  }
}
