// PeerConnection protocol dispatch, against fake Router/Transport objects —
// no real mediasoup worker needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { PeerConnection } from "../peer.js";
import type { Proto4WebrtcSfu } from "../sfu.js";

function withEmitter<T extends object>(props: T) {
  return Object.assign(new EventEmitter(), props);
}

class FakeWs {
  sent: any[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
}

function makeFakeSfu() {
  let n = 0;
  const producers = new Map<string, any>();
  const dataProducers = new Map<string, any>();
  const peers = new Set<any>();
  const events = new EventEmitter();

  const router = {
    rtpCapabilities: { codecs: ["fake"] },
    canConsume: () => true,
    async createWebRtcTransport() {
      const id = `transport-${n++}`;
      return {
        id,
        iceParameters: {},
        iceCandidates: [],
        dtlsParameters: {},
        sctpParameters: undefined,
        async connect() {},
        async produce({ kind, rtpParameters, appData }: any) {
          return withEmitter({ id: `producer-${id}`, kind, rtpParameters, appData });
        },
        async produceData({ label, appData }: any) {
          return withEmitter({ id: `dp-${id}`, label, appData });
        },
        async consume({ producerId }: any) {
          return withEmitter({
            id: `consumer-${id}`,
            producerId,
            kind: "video",
            rtpParameters: {},
            resume: async () => {},
          });
        },
        async consumeData({ dataProducerId }: any) {
          return withEmitter({
            id: `dc-${id}`,
            dataProducerId,
            sctpStreamParameters: {},
            label: "x",
            protocol: "",
          });
        },
        close() {},
      };
    },
  };

  return {
    config: { webRtcTransport: {} },
    producers,
    dataProducers,
    peers,
    events,
    router,
    async connectToSfu() {},
    getIceServers: () => [{ urls: "stun:stun.example.com" }],
  } as unknown as Proto4WebrtcSfu;
}

async function send(peer: PeerConnection, msg: Record<string, unknown>) {
  await peer.handle(JSON.stringify(msg));
}

test("getRtpCapabilities replies with the router's capabilities", async () => {
  const sfu = makeFakeSfu();
  const ws = new FakeWs();
  const peer = new PeerConnection(sfu, ws as any);
  await send(peer, { id: 1, action: "getRtpCapabilities" });
  assert.deepEqual(ws.sent, [{ id: 1, ok: true, data: { codecs: ["fake"] } }]);
});

test("unknown action replies with an error, not a thrown exception", async () => {
  const sfu = makeFakeSfu();
  const ws = new FakeWs();
  const peer = new PeerConnection(sfu, ws as any);
  await send(peer, { id: 2, action: "bogus" });
  assert.equal(ws.sent[0].ok, false);
  assert.match(ws.sent[0].error, /bogus/);
});

test("produce registers on the shared registry and broadcasts to other peers, not the origin", async () => {
  const sfu = makeFakeSfu();
  const wsA = new FakeWs();
  const wsB = new FakeWs();
  const peerA = new PeerConnection(sfu, wsA as any);
  new PeerConnection(sfu, wsB as any);

  await send(peerA, { id: 1, action: "createTransport" });
  const transportId = wsA.sent[0].data.id;
  await send(peerA, {
    id: 2,
    action: "produce",
    transportId,
    kind: "video",
    rtpParameters: {},
    appData: { label: "camera" },
  });

  assert.equal(sfu.producers.size, 1);
  const broadcast = wsB.sent.find((m: any) => m.event === "newProducer");
  assert.ok(broadcast);
  assert.equal(broadcast.appData.label, "camera");
  assert.equal(wsA.sent.some((m: any) => m.event === "newProducer"), false);
});

test("produceData registers on the shared registry and emits the internal dataProducer event", async () => {
  const sfu = makeFakeSfu();
  const ws = new FakeWs();
  const peer = new PeerConnection(sfu, ws as any);
  let emitted: any;
  sfu.events.on("dataProducer", (dp: any) => {
    emitted = dp;
  });

  await send(peer, { id: 1, action: "createTransport" });
  const transportId = ws.sent[0].data.id;
  await send(peer, {
    id: 2,
    action: "produceData",
    transportId,
    label: "telemetry",
    sctpStreamParameters: {},
  });

  assert.ok(emitted);
  assert.equal(emitted.label, "telemetry");
  assert.equal(sfu.dataProducers.size, 1);
});

test("close() removes the peer's producers from the shared registry and broadcasts *Closed events", async () => {
  const sfu = makeFakeSfu();
  const wsA = new FakeWs();
  const wsB = new FakeWs();
  const peerA = new PeerConnection(sfu, wsA as any);
  new PeerConnection(sfu, wsB as any);

  await send(peerA, { id: 1, action: "createTransport" });
  const transportId = wsA.sent[0].data.id;
  await send(peerA, {
    id: 2,
    action: "produce",
    transportId,
    kind: "video",
    rtpParameters: {},
    appData: {},
  });
  assert.equal(sfu.producers.size, 1);

  peerA.close();

  assert.equal(sfu.producers.size, 0);
  assert.equal(sfu.peers.has(peerA), false);
  assert.ok(wsB.sent.some((m: any) => m.event === "producerClosed"));
});
