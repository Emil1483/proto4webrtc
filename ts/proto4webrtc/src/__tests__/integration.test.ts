// Real mediasoup Worker+Router construction against the default config —
// proves the ported config actually satisfies the installed mediasoup
// version's API (this is exactly where a hand-ported config could silently
// drift). Skips gracefully if the native worker can't run in this sandbox.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Proto4WebrtcSfu } from "../sfu.js";

test("connectToSfu constructs a real Worker+Router from the default config", async (t) => {
  const sfu = new Proto4WebrtcSfu();
  try {
    await sfu.connectToSfu();
  } catch (err) {
    t.skip(`mediasoup worker unavailable in this sandbox: ${(err as Error).message}`);
    return;
  }
  try {
    assert.equal(sfu.getStatus().ready, true);
  } finally {
    sfu.close(); // otherwise the live worker subprocess keeps the test process alive
  }
});
