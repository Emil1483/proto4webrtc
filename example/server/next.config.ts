import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone",
  // mediasoup is a native lib; keep it external (don't bundle) and make sure its
  // worker binary is copied into the standalone output (it's spawned by path,
  // not require()'d, so tracing misses it otherwise).
  serverExternalPackages: ["mediasoup"],
  outputFileTracingIncludes: {
    "/api/sfu": ["./node_modules/mediasoup/worker/out/**/*"],
  },
};

export default nextConfig;
