import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone",
  // proto4webrtc is a file: dep symlinked to ../../ts/proto4webrtc; widen
  // Turbopack's root to the repo so it resolves outside this app's lockfile
  // boundary.
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // mediasoup is a native lib; keep it external (don't bundle) and make sure its
  // worker binary is copied into the standalone output (it's spawned by path,
  // not require()'d, so tracing misses it otherwise).
  serverExternalPackages: ["mediasoup"],
  outputFileTracingIncludes: {
    "/api/sfu": ["./node_modules/mediasoup/worker/out/**/*"],
  },
};

export default nextConfig;
