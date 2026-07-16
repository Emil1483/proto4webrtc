// Proto4WebrtcSfu.subscribe() and config merging — the DirectTransport is
// faked (no real mediasoup worker needed); a real construction is covered
// separately in integration.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { Proto4WebrtcSfu } from "../sfu.js";
import { defaultConfig, resolveConfig } from "../config.js";

function withEmitter<T extends object>(props: T) {
  return Object.assign(new EventEmitter(), props);
}

function makeSfuWithFakeDirectTransport() {
  const sfu = new Proto4WebrtcSfu();
  const consumers: any[] = [];
  (sfu as any).connectToSfu = async () => {};
  (sfu as any).getDirectTransport = async () => ({
    consumeData: async ({ dataProducerId }: { dataProducerId: string }) => {
      const consumer = withEmitter({ id: `consumer-${dataProducerId}`, close() {} });
      consumers.push(consumer);
      return consumer;
    },
  });
  return { sfu, consumers };
}

const settle = () => new Promise((r) => setImmediate(r));

test("resolveConfig: no override returns the defaults, wildcard listens get an announced address", () => {
  const resolved = resolveConfig();
  assert.deepEqual(resolved.worker, defaultConfig.worker);
  assert.deepEqual(resolved.router, defaultConfig.router);
  // The default 0.0.0.0 listenInfos are unusable as ICE candidates verbatim;
  // resolveConfig announces a detected address (or loopback) on each.
  const listenInfos =
    "listenInfos" in resolved.webRtcTransport
      ? resolved.webRtcTransport.listenInfos!
      : [];
  assert.equal(listenInfos.length, 2);
  for (const info of listenInfos) {
    assert.equal(info.ip, "0.0.0.0");
    assert.match(String(info.announcedAddress), /^\d+\.\d+\.\d+\.\d+$/);
  }
  const { listenInfos: _a, ...restResolved } = resolved.webRtcTransport as never;
  const { listenInfos: _b, ...restDefault } = defaultConfig.webRtcTransport as never;
  assert.deepEqual(restResolved, restDefault);
});

test("resolveConfig: an explicit announcedAddress on a wildcard listen is kept", () => {
  const resolved = resolveConfig({
    webRtcTransport: {
      listenInfos: [
        { protocol: "udp", ip: "0.0.0.0", announcedAddress: "203.0.113.7" },
      ],
    },
  });
  const listenInfos =
    "listenInfos" in resolved.webRtcTransport
      ? resolved.webRtcTransport.listenInfos!
      : [];
  assert.equal(listenInfos[0].announcedAddress, "203.0.113.7");
});

test("resolveConfig: overriding one field in a section keeps its other default fields", () => {
  const resolved = resolveConfig({ worker: { logLevel: "debug" } });
  assert.equal(resolved.worker.logLevel, "debug");
  assert.equal(resolved.worker.rtcMinPort, defaultConfig.worker.rtcMinPort);
});

test("resolveConfig: iceServers defaults to STUN only", () => {
  const resolved = resolveConfig();
  assert.deepEqual(resolved.iceServers, [{ urls: "stun:stun.l.google.com:19302" }]);
});

test("resolveConfig: iceServers override replaces the default wholesale", () => {
  const turn = [{ urls: "turn:example.com:3478", username: "u", credential: "p" }];
  const resolved = resolveConfig({ iceServers: turn });
  assert.deepEqual(resolved.iceServers, turn);
});

test("getIceServers returns the resolved config's iceServers", () => {
  const turn = [{ urls: "turn:example.com:3478" }];
  const sfu = new Proto4WebrtcSfu({ iceServers: turn });
  assert.deepEqual(sfu.getIceServers(), turn);
});

test("getStatus reflects an unconnected instance", () => {
  const sfu = new Proto4WebrtcSfu();
  assert.deepEqual(sfu.getStatus(), { ready: false, peers: 0, producers: 0, dataProducers: 0 });
});

test("subscribe: consumes a dataProducer already registered under the label", async () => {
  const { sfu, consumers } = makeSfuWithFakeDirectTransport();
  const dp = withEmitter({ id: "dp1", label: "telemetry" });
  sfu.dataProducers.set(dp.id, dp);

  const received: Uint8Array[] = [];
  sfu.subscribe("telemetry", (data) => received.push(data));
  await settle();

  assert.equal(consumers.length, 1);
  consumers[0].emit("message", new Uint8Array([1, 2, 3]));
  assert.deepEqual(received, [new Uint8Array([1, 2, 3])]);
});

test("subscribe: called before the producer exists, picks it up via the dataProducer event", async () => {
  const { sfu, consumers } = makeSfuWithFakeDirectTransport();
  sfu.subscribe("snapshot", () => {});
  assert.equal(consumers.length, 0);

  const dp = withEmitter({ id: "dp2", label: "snapshot" });
  sfu.dataProducers.set(dp.id, dp);
  sfu.events.emit("dataProducer", dp);
  await settle();

  assert.equal(consumers.length, 1);
});

test("subscribe: ignores dataProducer events for a different label", async () => {
  const { sfu, consumers } = makeSfuWithFakeDirectTransport();
  sfu.subscribe("telemetry", () => {});
  sfu.events.emit("dataProducer", withEmitter({ id: "dp3", label: "other" }));
  await settle();
  assert.equal(consumers.length, 0);
});

test("subscribe: re-consumes automatically after a reconnect (new dataProducer, same label)", async () => {
  const { sfu, consumers } = makeSfuWithFakeDirectTransport();
  const dp1 = withEmitter({ id: "dp4", label: "telemetry" });
  sfu.dataProducers.set(dp1.id, dp1);
  sfu.subscribe("telemetry", () => {});
  await settle();
  assert.equal(consumers.length, 1);

  consumers[0].emit("dataproducerclose");
  sfu.events.emit("dataProducer", withEmitter({ id: "dp5", label: "telemetry" }));
  await settle();

  assert.equal(consumers.length, 2);
});

test("subscribe: the returned unsubscribe closes the current consumer and stops future ones", async () => {
  const { sfu, consumers } = makeSfuWithFakeDirectTransport();
  const dp = withEmitter({ id: "dp6", label: "telemetry" });
  sfu.dataProducers.set(dp.id, dp);
  const unsubscribe = sfu.subscribe("telemetry", () => {});
  await settle();

  let closed = false;
  consumers[0].close = () => {
    closed = true;
  };
  unsubscribe();
  assert.ok(closed);

  sfu.events.emit("dataProducer", withEmitter({ id: "dp7", label: "telemetry" }));
  await settle();
  assert.equal(consumers.length, 1);
});
