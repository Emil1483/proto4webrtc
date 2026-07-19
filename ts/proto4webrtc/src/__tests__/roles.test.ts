// PeerConnection role enforcement — fake Router/Transport objects, no real
// mediasoup worker (same harness as peer.test.ts). The SFU no longer verifies
// tokens; the host resolves a Role and hands it to each PeerConnection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { PeerConnection } from "../peer.js";
import { Role } from "../roles.js";
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
  const router = {
    rtpCapabilities: {},
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
    producers: new Map<string, any>(),
    dataProducers: new Map<string, any>(),
    peers: new Set<any>(),
    events: new EventEmitter(),
    router,
    async connectToSfu() {},
    getIceServers: () => [],
  } as unknown as Proto4WebrtcSfu;
}

async function send(peer: PeerConnection, msg: Record<string, unknown>) {
  await peer.handle(JSON.stringify(msg));
}

function makePeer(sfu: Proto4WebrtcSfu, role: Role) {
  const ws = new FakeWs();
  const peer = new PeerConnection(sfu, ws as any, role);
  return { peer, ws };
}

async function createTransport(peer: PeerConnection, ws: FakeWs) {
  await send(peer, { id: 1, action: "createTransport" });
  return ws.sent[0].data.id as string;
}

test("default role is robot (no-auth: full access)", async () => {
  const sfu = makeFakeSfu();
  const ws = new FakeWs();
  const peer = new PeerConnection(sfu, ws as any); // no role -> Role.ROBOT
  const transportId = await createTransport(peer, ws);
  await send(peer, { id: 2, action: "produce", transportId, kind: "video", rtpParameters: {} });
  assert.equal(ws.sent[1].ok, true);
});

test("guest cannot produce media", async () => {
  const sfu = makeFakeSfu();
  const { peer, ws } = makePeer(sfu, Role.GUEST);
  const transportId = await createTransport(peer, ws);
  await send(peer, { id: 2, action: "produce", transportId, kind: "video", rtpParameters: {} });
  assert.equal(ws.sent[1].ok, false);
  assert.match(ws.sent[1].error, /permission denied/);
});

test("admin cannot produce a stream, only rpc request channels", async () => {
  const sfu = makeFakeSfu();
  const { peer, ws } = makePeer(sfu, Role.ADMIN);
  const transportId = await createTransport(peer, ws);
  await send(peer, {
    id: 2,
    action: "produceData",
    transportId,
    sctpStreamParameters: {},
    label: "telemetry",
  });
  assert.equal(ws.sent[1].ok, false);
  assert.match(ws.sent[1].error, /robot role/);
});

test("browser rpc request channels get the resolved role stamped into appData", async () => {
  const sfu = makeFakeSfu();
  const { peer, ws } = makePeer(sfu, Role.GUEST);
  const transportId = await createTransport(peer, ws);
  await send(peer, {
    id: 2,
    action: "produceData",
    transportId,
    sctpStreamParameters: {},
    label: "rov_control/requests",
    // A malicious client claiming admin gets overwritten, protected stripped.
    appData: { role: Role.ADMIN, protected: true, keep: "me" },
  });
  assert.equal(ws.sent[1].ok, true);
  const dp = [...sfu.dataProducers.values()][0];
  assert.deepEqual(dp.appData, { keep: "me", role: Role.GUEST });
});

test("robot can produce streams with protected appData intact", async () => {
  const sfu = makeFakeSfu();
  const { peer, ws } = makePeer(sfu, Role.ROBOT);
  const transportId = await createTransport(peer, ws);
  await send(peer, {
    id: 2,
    action: "produceData",
    transportId,
    sctpStreamParameters: {},
    label: "secret_telemetry",
    appData: { protected: true },
  });
  assert.equal(ws.sent[1].ok, true);
  const dp = [...sfu.dataProducers.values()][0];
  assert.equal(dp.appData.protected, true);
});

test("guest is denied consumeData of a protected stream; admin is not", async () => {
  const sfu = makeFakeSfu();
  const { peer: robot, ws: robotWs } = makePeer(sfu, Role.ROBOT);
  const robotTransport = await createTransport(robot, robotWs);
  await send(robot, {
    id: 2,
    action: "produceData",
    transportId: robotTransport,
    sctpStreamParameters: {},
    label: "secret_telemetry",
    appData: { protected: true },
  });
  const dataProducerId = robotWs.sent[1].data.id;

  const { peer: guest, ws: guestWs } = makePeer(sfu, Role.GUEST);
  const guestTransport = await createTransport(guest, guestWs);
  await send(guest, { id: 2, action: "consumeData", transportId: guestTransport, dataProducerId });
  assert.equal(guestWs.sent.at(-1).ok, false);
  assert.match(guestWs.sent.at(-1).error, /protected/);

  const { peer: admin, ws: adminWs } = makePeer(sfu, Role.ADMIN);
  const adminTransport = await createTransport(admin, adminWs);
  await send(admin, { id: 2, action: "consumeData", transportId: adminTransport, dataProducerId });
  assert.equal(adminWs.sent.at(-1).ok, true);
});

test("guest is denied consume of a protected media producer", async () => {
  const sfu = makeFakeSfu();
  const { peer: robot, ws: robotWs } = makePeer(sfu, Role.ROBOT);
  const robotTransport = await createTransport(robot, robotWs);
  await send(robot, {
    id: 2,
    action: "produce",
    transportId: robotTransport,
    kind: "video",
    rtpParameters: {},
    appData: { label: "inspection_cam", protected: true },
  });
  const producerId = robotWs.sent[1].data.id;

  const { peer: guest, ws: guestWs } = makePeer(sfu, Role.GUEST);
  const guestTransport = await createTransport(guest, guestWs);
  await send(guest, {
    id: 2,
    action: "consume",
    transportId: guestTransport,
    producerId,
    rtpCapabilities: {},
  });
  assert.equal(guestWs.sent.at(-1).ok, false);
  assert.match(guestWs.sent.at(-1).error, /protected/);
});

test("guest can consume a non-protected stream", async () => {
  const sfu = makeFakeSfu();
  const { peer: robot, ws: robotWs } = makePeer(sfu, Role.ROBOT);
  const robotTransport = await createTransport(robot, robotWs);
  await send(robot, {
    id: 2,
    action: "produceData",
    transportId: robotTransport,
    sctpStreamParameters: {},
    label: "telemetry",
  });
  const dataProducerId = robotWs.sent[1].data.id;

  const { peer: guest, ws: guestWs } = makePeer(sfu, Role.GUEST);
  const guestTransport = await createTransport(guest, guestWs);
  await send(guest, { id: 2, action: "consumeData", transportId: guestTransport, dataProducerId });
  assert.equal(guestWs.sent.at(-1).ok, true);
});
