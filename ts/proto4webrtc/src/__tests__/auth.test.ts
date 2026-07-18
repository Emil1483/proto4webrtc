// Token verification (auth.ts) and PeerConnection role enforcement — fake
// Router/Transport objects, no real mediasoup worker (same harness as
// peer.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";

import { resolveRole, tokenFromUrl, verifyJwtHs256 } from "../auth.js";
import { PeerConnection } from "../peer.js";
import type { Proto4WebrtcSfu } from "../sfu.js";

const SECRET = "test-secret";

function b64url(data: string | Buffer): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeJwt(claims: object, secret = SECRET, alg = "HS256"): string {
  const head = b64url(JSON.stringify({ alg, typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = b64url(
    createHmac("sha256", secret).update(`${head}.${body}`).digest(),
  );
  return `${head}.${body}.${sig}`;
}

// --- verifyJwtHs256 ---------------------------------------------------------

test("verifyJwtHs256 accepts a valid token and returns its claims", () => {
  const claims = verifyJwtHs256(makeJwt({ role: "admin", sub: "u1" }), SECRET);
  assert.equal(claims.role, "admin");
  assert.equal(claims.sub, "u1");
});

test("verifyJwtHs256 rejects a bad signature", () => {
  assert.throws(
    () => verifyJwtHs256(makeJwt({ role: "admin" }, "other-secret"), SECRET),
    /bad signature/,
  );
});

test("verifyJwtHs256 rejects an expired token", () => {
  const exp = Math.floor(Date.now() / 1000) - 60;
  assert.throws(
    () => verifyJwtHs256(makeJwt({ role: "admin", exp }), SECRET),
    /expired/,
  );
});

test("verifyJwtHs256 rejects a missing or unknown role claim", () => {
  assert.throws(() => verifyJwtHs256(makeJwt({}), SECRET), /role/);
  assert.throws(
    () => verifyJwtHs256(makeJwt({ role: "superuser" }), SECRET),
    /role/,
  );
});

test("verifyJwtHs256 rejects non-HS256 algs (no alg:none downgrade)", () => {
  const head = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = b64url(JSON.stringify({ role: "admin" }));
  assert.throws(() => verifyJwtHs256(`${head}.${body}.`, SECRET), /alg/);
});

// --- resolveRole ------------------------------------------------------------

test("resolveRole: auth disabled means every peer is robot", async () => {
  assert.equal(await resolveRole({}, undefined), "robot");
  assert.equal(await resolveRole({}, "garbage"), "robot");
});

test("resolveRole: auth enabled, no token means guest", async () => {
  assert.equal(await resolveRole({ secret: SECRET }, undefined), "guest");
});

test("resolveRole: verified token yields its role claim", async () => {
  assert.equal(
    await resolveRole({ secret: SECRET }, makeJwt({ role: "robot" })),
    "robot",
  );
});

test("resolveRole: custom verifyToken overrides the built-in verifier", async () => {
  const role = await resolveRole(
    { verifyToken: () => ({ role: "admin" }) },
    "opaque-session-token",
  );
  assert.equal(role, "admin");
});

test("tokenFromUrl extracts the token query parameter", () => {
  assert.equal(tokenFromUrl("/api/sfu?token=abc%20d"), "abc d");
  assert.equal(tokenFromUrl("/api/sfu"), undefined);
  assert.equal(tokenFromUrl(undefined), undefined);
});

// --- PeerConnection enforcement ----------------------------------------------

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

function makePeer(sfu: Proto4WebrtcSfu, role: "guest" | "admin" | "robot") {
  const ws = new FakeWs();
  const peer = new PeerConnection(sfu, ws as any, Promise.resolve(role));
  return { peer, ws };
}

async function createTransport(peer: PeerConnection, ws: FakeWs) {
  await send(peer, { id: 1, action: "createTransport" });
  return ws.sent[0].data.id as string;
}

test("guest cannot produce media", async () => {
  const sfu = makeFakeSfu();
  const { peer, ws } = makePeer(sfu, "guest");
  const transportId = await createTransport(peer, ws);
  await send(peer, { id: 2, action: "produce", transportId, kind: "video", rtpParameters: {} });
  assert.equal(ws.sent[1].ok, false);
  assert.match(ws.sent[1].error, /permission denied/);
});

test("admin cannot produce a stream, only rpc request channels", async () => {
  const sfu = makeFakeSfu();
  const { peer, ws } = makePeer(sfu, "admin");
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

test("browser rpc request channels get the verified role stamped into appData", async () => {
  const sfu = makeFakeSfu();
  const { peer, ws } = makePeer(sfu, "guest");
  const transportId = await createTransport(peer, ws);
  await send(peer, {
    id: 2,
    action: "produceData",
    transportId,
    sctpStreamParameters: {},
    label: "rov_control/requests",
    // A malicious client claiming admin gets overwritten, protected stripped.
    appData: { role: "admin", protected: true, keep: "me" },
  });
  assert.equal(ws.sent[1].ok, true);
  const dp = [...sfu.dataProducers.values()][0];
  assert.deepEqual(dp.appData, { keep: "me", role: "guest" });
});

test("robot can produce streams with protected appData intact", async () => {
  const sfu = makeFakeSfu();
  const { peer, ws } = makePeer(sfu, "robot");
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
  const { peer: robot, ws: robotWs } = makePeer(sfu, "robot");
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

  const { peer: guest, ws: guestWs } = makePeer(sfu, "guest");
  const guestTransport = await createTransport(guest, guestWs);
  await send(guest, { id: 2, action: "consumeData", transportId: guestTransport, dataProducerId });
  assert.equal(guestWs.sent.at(-1).ok, false);
  assert.match(guestWs.sent.at(-1).error, /protected/);

  const { peer: admin, ws: adminWs } = makePeer(sfu, "admin");
  const adminTransport = await createTransport(admin, adminWs);
  await send(admin, { id: 2, action: "consumeData", transportId: adminTransport, dataProducerId });
  assert.equal(adminWs.sent.at(-1).ok, true);
});

test("guest is denied consume of a protected media producer", async () => {
  const sfu = makeFakeSfu();
  const { peer: robot, ws: robotWs } = makePeer(sfu, "robot");
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

  const { peer: guest, ws: guestWs } = makePeer(sfu, "guest");
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
  const { peer: robot, ws: robotWs } = makePeer(sfu, "robot");
  const robotTransport = await createTransport(robot, robotWs);
  await send(robot, {
    id: 2,
    action: "produceData",
    transportId: robotTransport,
    sctpStreamParameters: {},
    label: "telemetry",
  });
  const dataProducerId = robotWs.sent[1].data.id;

  const { peer: guest, ws: guestWs } = makePeer(sfu, "guest");
  const guestTransport = await createTransport(guest, guestWs);
  await send(guest, { id: 2, action: "consumeData", transportId: guestTransport, dataProducerId });
  assert.equal(guestWs.sent.at(-1).ok, true);
});

test("a peer whose token was rejected gets no replies at all", async () => {
  const sfu = makeFakeSfu();
  const ws = new FakeWs();
  const peer = new PeerConnection(sfu, ws as any, Promise.resolve(undefined));
  await send(peer, { id: 1, action: "getRtpCapabilities" });
  assert.deepEqual(ws.sent, []);
});
