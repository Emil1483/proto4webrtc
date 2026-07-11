// The signaling protocol handler for one connected WebSocket peer (robot
// producer or browser consumer). Ported from web-rtc-test/server's
// sfu.ts `Peer` class; module-level registries there become references to
// the owning Proto4WebrtcSfu instance here so multiple peers share one SFU.

import type { types } from "mediasoup";
import type { WebSocket } from "ws";

import type { Proto4WebrtcSfu } from "./sfu.js";

function describeProducer(p: types.Producer) {
  return { producerId: p.id, kind: p.kind, appData: p.appData };
}
function describeDataProducer(p: types.DataProducer) {
  return { dataProducerId: p.id, label: p.label, appData: p.appData };
}

interface Envelope {
  id?: number;
  action?: string;
  event?: string;
  [key: string]: unknown;
}

export class PeerConnection {
  private readonly sfu: Proto4WebrtcSfu;
  private readonly ws: WebSocket;
  private transports = new Map<string, types.WebRtcTransport>();
  private producers = new Map<string, types.Producer>();
  private consumers = new Map<string, types.Consumer>();
  private dataProducers = new Map<string, types.DataProducer>();
  private dataConsumers = new Map<string, types.DataConsumer>();

  constructor(sfu: Proto4WebrtcSfu, ws: WebSocket) {
    this.sfu = sfu;
    this.ws = ws;
    sfu.peers.add(this);
  }

  private send(msg: Envelope) {
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  private reply(id: number | undefined, data: unknown) {
    if (id !== undefined) this.send({ id, ok: true, data });
  }
  private replyError(id: number | undefined, error: string) {
    if (id !== undefined) this.send({ id, ok: false, error });
  }

  async handle(raw: unknown): Promise<void> {
    let msg: Envelope;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    try {
      await this.sfu.connectToSfu();

      switch (msg.action) {
        case "getRtpCapabilities":
          return this.reply(msg.id, this.sfu.router.rtpCapabilities);

        case "getProducers":
          // Late joiner: list what's already being produced.
          return this.reply(msg.id, {
            producers: [...this.sfu.producers.values()].map(describeProducer),
            dataProducers: [...this.sfu.dataProducers.values()].map(describeDataProducer),
          });

        case "createTransport":
          return this.reply(msg.id, await this.createTransport());

        case "connectTransport":
          await this.getTransport(msg.transportId as string).connect({
            dtlsParameters: msg.dtlsParameters as types.DtlsParameters,
          });
          return this.reply(msg.id, {});

        case "produce":
          return this.reply(msg.id, await this.produce(msg));

        case "produceData":
          return this.reply(msg.id, await this.produceData(msg));

        case "consume":
          return this.reply(msg.id, await this.consume(msg));

        case "consumeData":
          return this.reply(msg.id, await this.consumeData(msg));

        case "resumeConsumer":
          await this.consumers.get(msg.consumerId as string)?.resume();
          return this.reply(msg.id, {});

        default:
          return this.replyError(msg.id, `unknown action: ${msg.action}`);
      }
    } catch (err) {
      this.replyError(msg.id, err instanceof Error ? err.message : "error");
    }
  }

  private getTransport(id: string): types.WebRtcTransport {
    const t = this.transports.get(id);
    if (!t) throw new Error(`no transport ${id}`);
    return t;
  }

  private async createTransport() {
    const transport = await this.sfu.router.createWebRtcTransport(
      this.sfu.config.webRtcTransport,
    );
    this.transports.set(transport.id, transport);
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  }

  private async produce(msg: Envelope) {
    const transport = this.getTransport(msg.transportId as string);
    const producer = await transport.produce({
      kind: msg.kind as types.MediaKind,
      rtpParameters: msg.rtpParameters as types.RtpParameters,
      appData: (msg.appData as types.AppData) ?? {},
    });
    this.producers.set(producer.id, producer);
    this.sfu.producers.set(producer.id, producer);
    producer.on("transportclose", () => this.producers.delete(producer.id));
    this.broadcastExcept({ event: "newProducer", ...describeProducer(producer) });
    return { id: producer.id };
  }

  private async produceData(msg: Envelope) {
    const transport = this.getTransport(msg.transportId as string);
    const dataProducer = await transport.produceData({
      sctpStreamParameters: msg.sctpStreamParameters as types.SctpStreamParameters,
      label: msg.label as string | undefined,
      protocol: msg.protocol as string | undefined,
      appData: (msg.appData as types.AppData) ?? {},
    });
    this.dataProducers.set(dataProducer.id, dataProducer);
    this.sfu.dataProducers.set(dataProducer.id, dataProducer);
    this.broadcastExcept({
      event: "newDataProducer",
      ...describeDataProducer(dataProducer),
    });
    // in-process subscribe() listens here — separate from the ws broadcast above.
    this.sfu.events.emit("dataProducer", dataProducer);
    return { id: dataProducer.id };
  }

  private async consume(msg: Envelope) {
    const producerId = msg.producerId as string;
    const rtpCapabilities = msg.rtpCapabilities as types.RtpCapabilities;
    if (!this.sfu.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(`cannot consume ${producerId}`);
    }
    const transport = this.getTransport(msg.transportId as string);
    // Start paused; client resumes after wiring up (avoids losing early frames).
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    this.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => this.consumers.delete(consumer.id));
    consumer.on("producerclose", () => {
      this.consumers.delete(consumer.id);
      this.send({ event: "consumerClosed", consumerId: consumer.id });
    });
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  private async consumeData(msg: Envelope) {
    const transport = this.getTransport(msg.transportId as string);
    const dataConsumer = await transport.consumeData({
      dataProducerId: msg.dataProducerId as string,
    });
    this.dataConsumers.set(dataConsumer.id, dataConsumer);
    dataConsumer.on("dataproducerclose", () => this.dataConsumers.delete(dataConsumer.id));
    return {
      id: dataConsumer.id,
      dataProducerId: dataConsumer.dataProducerId,
      sctpStreamParameters: dataConsumer.sctpStreamParameters,
      label: dataConsumer.label,
      protocol: dataConsumer.protocol,
    };
  }

  close(): void {
    for (const producer of this.producers.values()) {
      this.sfu.producers.delete(producer.id);
      this.broadcastExcept({ event: "producerClosed", producerId: producer.id });
    }
    for (const dataProducer of this.dataProducers.values()) {
      this.sfu.dataProducers.delete(dataProducer.id);
      this.broadcastExcept({
        event: "dataProducerClosed",
        dataProducerId: dataProducer.id,
      });
    }
    for (const transport of this.transports.values()) transport.close();
    this.transports.clear();
    this.sfu.peers.delete(this);
  }

  private broadcastExcept(msg: Envelope) {
    for (const peer of this.sfu.peers) {
      if (peer !== this) peer.send(msg);
    }
  }
}
