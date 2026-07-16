// proto4webrtc consumer generator (TypeScript target).
//
// Extracts messages annotated with (proto4webrtc.data_stream) /
// (proto4webrtc.media_stream) and renders proto4webrtc.ts: typed mediasoup
// consumer wrappers over the protoc-gen-es message classes. Run it next to
// protoc-gen-es with the same `out` directory, and (under buf) with
// `strategy: all` — the plugin aggregates every stream into one file, so it
// must see all files in a single invocation.
//
// Counterpart of the Python producer plugin (pip package `proto4webrtc`).

import { create, fromBinary, toBinary, createFileRegistry, hasOption, getOption } from "@bufbuild/protobuf";
import {
  CodeGeneratorRequestSchema,
  CodeGeneratorResponseSchema,
  CodeGeneratorResponse_Feature,
  FileDescriptorSetSchema,
} from "@bufbuild/protobuf/wkt";

class GenError extends Error {}

export function runPlugin(requestBytes) {
  const request = fromBinary(CodeGeneratorRequestSchema, requestBytes);
  const supportedFeatures = BigInt(CodeGeneratorResponse_Feature.PROTO3_OPTIONAL);
  let init;
  try {
    init = {
      supportedFeatures,
      file: [{ name: "proto4webrtc.ts", content: generate(request) }],
    };
  } catch (err) {
    if (!(err instanceof GenError)) throw err;
    init = { supportedFeatures, error: err.message };
  }
  return toBinary(
    CodeGeneratorResponseSchema,
    create(CodeGeneratorResponseSchema, init),
  );
}

function generate(request) {
  const registry = createFileRegistry(
    create(FileDescriptorSetSchema, { file: request.protoFile }),
  );
  const targets = new Set(request.fileToGenerate);

  const dataExt = registry.getExtension("proto4webrtc.data_stream");
  const mediaExt = registry.getExtension("proto4webrtc.media_stream");
  const mediaKind = registry.getEnum("proto4webrtc.MediaKind");
  if (!dataExt || !mediaExt || !mediaKind) {
    throw new GenError(
      "proto4webrtc/options.proto missing from the compiled files",
    );
  }

  const dataStreams = [];
  const mediaStreams = [];

  for (const file of registry.files) {
    if (!targets.has(file.proto.name)) continue;
    for (const message of file.messages) {
      if (hasOption(message, dataExt)) {
        const o = getOption(message, dataExt);
        if (!o.label)
          throw new GenError(`${message.typeName}: data_stream needs a label`);
        dataStreams.push({
          message: message.name,
          typeName: message.typeName,
          protoFile: file.proto.name,
          label: o.label,
          // A scalar `stamp` field enables automatic stale-message dropping
          // in the generated subscribe() (data channels deliver unordered).
          hasStamp: message.fields.some(
            (f) => f.name === "stamp" && f.fieldKind === "scalar",
          ),
        });
      }
      if (hasOption(message, mediaExt)) {
        const o = getOption(message, mediaExt);
        if (!o.label)
          throw new GenError(`${message.typeName}: media_stream needs a label`);
        const kind = mediaKind.values.find((v) => v.number === o.kind)?.name;
        if (!kind || kind === "MEDIA_KIND_UNSPECIFIED")
          throw new GenError(`${message.typeName}: media_stream needs kind`);
        mediaStreams.push({
          message: message.name,
          typeName: message.typeName,
          protoFile: file.proto.name,
          label: o.label,
          kind: kind.toLowerCase(),
        });
      }
    }
  }

  const labels = [...dataStreams, ...mediaStreams].map((s) => s.label);
  const dupes = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];
  if (dupes.length) throw new GenError(`duplicate stream labels: ${dupes}`);

  return render(dataStreams, mediaStreams);
}

// protoc-gen-es output path for a proto file, relative to the shared out dir.
const pbModule = (protoFile) => "./" + protoFile.replace(/\.proto$/, "_pb");

// "Telemetry" -> "TelemetryStream", but "CameraStream" stays as is.
const exportName = (message) =>
  message.endsWith("Stream") ? message : `${message}Stream`;

function render(dataStreams, mediaStreams) {
  const importBlocks = [...new Set(dataStreams.map((s) => s.protoFile))].map(
    (f) => {
      const messages = dataStreams
        .filter((s) => s.protoFile === f)
        .map((s) => s.message);
      const schemas = messages.map((m) => `${m}Schema`);
      return (
        `import { ${schemas.join(", ")} } from "${pbModule(f)}";\n` +
        `import type { ${messages.join(", ")} } from "${pbModule(f)}";\n` +
        `export type { ${messages.join(", ")} };`
      );
    },
  );

  const dataBlocks = dataStreams.map((s) => {
    const subscribeBody = s.hasStamp
      ? `\
    // Data channels deliver unordered; drop messages whose \`stamp\` isn't
    // newer than the last one delivered. A producer restart resets its clock,
    // so re-admit everything whenever a producer goes away.
    let lastStamp = -Infinity;
    const unsubscribe = sfu.subscribe(this.label, (data) => {
      const msg = this.decode(data);
      if (msg.stamp <= lastStamp) return;
      lastStamp = msg.stamp;
      onMessage(msg);
    });
    const unwatch = sfu.onProducerClosed?.(() => {
      lastStamp = -Infinity;
    });
    return () => {
      unsubscribe();
      unwatch?.();
    };`
      : `\
    return sfu.subscribe(this.label, (data) => onMessage(this.decode(data)));`;
    const subscribeDoc = s.hasStamp
      ? `\n   * Stale messages (non-increasing \`stamp\`) are dropped automatically.`
      : "";
    return `\
/** Data stream "${s.label}" (${s.typeName}). */
export const ${exportName(s.message)} = {
  label: "${s.label}",
  decode(data: ArrayBuffer | Uint8Array): ${s.message} {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return fromBinary(${s.message}Schema, bytes);
  },
  /** Decode every message on a mediasoup DataConsumer into the callback. */
  attach(
    dataConsumer: { on(event: "message", cb: (data: ArrayBuffer) => void): void },
    onMessage: (msg: ${s.message}) => void,
  ): void {
    dataConsumer.on("message", (data: ArrayBuffer) =>
      onMessage(this.decode(data)),
    );
  },
  /**
   * Typed, decoded messages into the callback. Works against a browser
   * Proto4WebrtcClient ("proto4webrtc/client") and, server-side in-process,
   * against a Proto4WebrtcSfu ("proto4webrtc") — both expose subscribe().${subscribeDoc}
   */
  subscribe(
    sfu: Proto4WebrtcSubscribable,
    onMessage: (msg: ${s.message}) => void,
  ): () => void {
${subscribeBody}
  },
} as const;`;
  });

  const mediaBlocks = mediaStreams.map(
    (s) => `\
/** Media stream "${s.label}" (${s.kind}); track arrives over RTP. */
export const ${exportName(s.message)} = {
  label: "${s.label}",
  kind: "${s.kind}",
  /**
   * Typed wrapper over Proto4WebrtcClient.onMedia() (npm package
   * "proto4webrtc/client"): the stream's track into the callback, covering
   * the producer already online and any that (re)appears later.
   */
  subscribe(
    client: Proto4WebrtcMediaSubscribable,
    onTrack: (track: MediaStreamTrack) => void,
  ): () => void {
    return client.onMedia(this.kind, onTrack);
  },
} as const;`,
  );

  // Typed client: connectToSfu() returns the runtime's Proto4WebrtcClient
  // extended with one subscribeTo<Stream>() method per declared stream.
  const clientMethods = [
    ...dataStreams.map((s) => ({
      name: exportName(s.message),
      sig: `subscribeTo${exportName(s.message)}(onMessage: (msg: ${s.message}) => void): () => void;`,
    })),
    ...mediaStreams.map((s) => ({
      name: exportName(s.message),
      sig: `subscribeTo${exportName(s.message)}(onTrack: (track: MediaStreamTrack) => void): () => void;`,
    })),
  ];
  const clientBlock = clientMethods.length
    ? `\
/** Proto4WebrtcClient extended with a typed subscribe method per stream. */
export interface StreamsClient extends Proto4WebrtcClient {
${clientMethods.map((m) => `  ${m.sig}`).join("\n")}
}

/**
 * Connect to the SFU signaling endpoint (proto4webrtc/client's connectToSfu)
 * and attach the typed per-stream subscribe methods:
 *
 *     const client = await connectToSfu({ onConnectionState: setState });
 *     client.subscribeTo${clientMethods[0].name}((...) => { ... });
 */
export async function connectToSfu(
  options?: Proto4WebrtcClientOptions,
): Promise<StreamsClient> {
  const client = (await proto4webrtcConnect(options)) as StreamsClient;
${clientMethods
  .map(
    (m) =>
      `  client.subscribeTo${m.name} = (cb) => ${m.name}.subscribe(client, cb);`,
  )
  .join("\n")}
  return client;
}
`
    : "";

  // A local structural type, not an import of the real Proto4WebrtcSfu class
  // (npm package "proto4webrtc") — so browser-only consumers (attach() against
  // a real mediasoup-client DataConsumer) never need that package installed
  // just to typecheck this file. The real class satisfies this structurally.
  const subscribableInterface =
    (dataStreams.length
      ? `\ninterface Proto4WebrtcSubscribable {
  subscribe(label: string, onMessage: (data: Uint8Array) => void): () => void;
  // Present on the browser Proto4WebrtcClient; used to reset stale-message
  // tracking when a producer restarts. Optional so the in-process
  // Proto4WebrtcSfu (ordered delivery, no reset needed) still satisfies this.
  onProducerClosed?(cb: () => void): () => void;
}\n`
      : "") +
    (mediaStreams.length
      ? `\ninterface Proto4WebrtcMediaSubscribable {
  onMedia(kind: string, onTrack: (track: MediaStreamTrack) => void): () => void;
}\n`
      : "");

  return `// Generated by protoc-gen-proto4webrtc-ts. Do not edit.
//
// Typed mediasoup consumer wrappers for the streams declared in the
// protofiles.
//
// Browser — connectToSfu() (wrapping npm package "proto4webrtc/client")
// returns the client extended with a typed method per stream:
//
//     const client = await connectToSfu();
//     client.subscribeToTelemetryStream((msg) => { ... });
//     client.subscribeToCameraStream((track) => { ... });
//
// Server-side, in-process (no browser, no WebRTC), against a
// Proto4WebrtcSfu (npm package "proto4webrtc") — same call:
//
//     TelemetryStream.subscribe(sfu, (msg) => { ... });
//
// Lower level, against a raw mediasoup(-client) DataConsumer:
//
//     TelemetryStream.attach(dataConsumer, (msg) => { ... });

import { fromBinary } from "@bufbuild/protobuf";
import {
  connectToSfu as proto4webrtcConnect,
  type Proto4WebrtcClient,
  type Proto4WebrtcClientOptions,
} from "proto4webrtc/client";
export type { Proto4WebrtcClient, Proto4WebrtcClientOptions };
${importBlocks.join("\n")}
${subscribableInterface}
${[...dataBlocks, ...mediaBlocks].join("\n\n")}

${clientBlock}`;
}
