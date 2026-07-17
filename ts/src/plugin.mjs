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
  const rpcExt = registry.getExtension("proto4webrtc.rpc_service");
  const mediaKind = registry.getEnum("proto4webrtc.MediaKind");
  if (!dataExt || !mediaExt || !mediaKind) {
    throw new GenError(
      "proto4webrtc/options.proto missing from the compiled files",
    );
  }

  const dataStreams = [];
  const mediaStreams = [];
  const rpcServices = [];

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
    for (const service of file.services) {
      // rpcExt is missing when the compiled set carries a pre-1.0
      // options.proto; only then can no service be annotated.
      if (!rpcExt || !hasOption(service, rpcExt)) continue;
      const o = getOption(service, rpcExt);
      if (!o.label)
        throw new GenError(`${service.typeName}: rpc_service needs a label`);
      const methods = service.methods.map((m) => {
        if (m.methodKind !== "unary")
          throw new GenError(
            `${service.typeName}.${m.name}: rpc_service supports unary methods only`,
          );
        return {
          wireName: m.name,
          localName: m.localName, // camelCase, e.g. "setLight"
          input: { message: m.input.name, protoFile: m.input.file.proto.name },
          output: { message: m.output.name, protoFile: m.output.file.proto.name },
        };
      });
      if (!methods.length)
        throw new GenError(`${service.typeName}: rpc_service declares no methods`);
      rpcServices.push({
        service: service.name,
        typeName: service.typeName,
        protoFile: file.proto.name,
        label: o.label,
        methods,
      });
    }
  }

  const labels = [...dataStreams, ...mediaStreams, ...rpcServices].map(
    (s) => s.label,
  );
  const dupes = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];
  if (dupes.length) throw new GenError(`duplicate stream labels: ${dupes}`);

  const methodNames = rpcServices.flatMap((s) =>
    s.methods.map((m) => m.localName),
  );
  const methodDupes = [
    ...new Set(methodNames.filter((n, i) => methodNames.indexOf(n) !== i)),
  ];
  if (methodDupes.length)
    throw new GenError(
      `duplicate rpc method names across services: ${methodDupes} ` +
        "(client.rpc merges every service's methods; rename one)",
    );

  return render(dataStreams, mediaStreams, rpcServices);
}

// protoc-gen-es output path for a proto file, relative to the shared out dir.
const pbModule = (protoFile) => "./" + protoFile.replace(/\.proto$/, "_pb");

// "Telemetry" -> "TelemetryStream", but "CameraStream" stays as is.
const exportName = (message) =>
  message.endsWith("Stream") ? message : `${message}Stream`;

function render(dataStreams, mediaStreams, rpcServices) {
  // proto file -> message names whose schema + type the generated file needs.
  const neededByFile = new Map();
  const need = (protoFile, message) => {
    if (!neededByFile.has(protoFile)) neededByFile.set(protoFile, new Set());
    neededByFile.get(protoFile).add(message);
  };
  for (const s of dataStreams) need(s.protoFile, s.message);
  for (const s of rpcServices)
    for (const m of s.methods) {
      need(m.input.protoFile, m.input.message);
      need(m.output.protoFile, m.output.message);
    }

  const nameToFiles = new Map();
  for (const [f, set] of neededByFile)
    for (const m of set)
      nameToFiles.set(m, [...(nameToFiles.get(m) ?? []), f]);
  const colliding = [...nameToFiles.entries()].filter(([, fs]) => fs.length > 1);
  if (colliding.length)
    throw new GenError(
      `colliding message names across proto files: ${colliding
        .map(([n]) => n)
        .join(", ")}`,
    );

  const importBlocks = [...neededByFile.entries()].map(([f, set]) => {
    const messages = [...set].sort();
    const schemas = messages.map((m) => `${m}Schema`);
    return (
      `import { ${schemas.join(", ")} } from "${pbModule(f)}";\n` +
      `import type { ${messages.join(", ")} } from "${pbModule(f)}";\n` +
      `export type { ${messages.join(", ")} };`
    );
  });

  const dataBlocks = dataStreams.map((s) => {
    const subscribeBody = s.hasStamp
      ? `\
    // Data channels may deliver unordered; by default drop messages whose
    // \`stamp\` isn't newer than the last one delivered. Pass
    // { dropOutOfOrder: false } for reliable-ordered streams where every
    // message matters and stamps aren't monotonic across producers. A
    // producer restart resets the clock, so re-admit everything when one goes.
    if (options?.dropOutOfOrder === false) {
      return sfu.subscribe(this.label, (data) => onMessage(this.decode(data)));
    }
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
      ? `\n   * Stale messages (non-increasing \`stamp\`) are dropped by default;
   * pass { dropOutOfOrder: false } to deliver every message.`
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
    onMessage: (msg: ${s.message}) => void,${
      s.hasStamp ? "\n    options?: { dropOutOfOrder?: boolean }," : ""
    }
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

  // Typed rpc: one camelCase method per rpc of every annotated service, all
  // merged onto client.rpc (uniqueness enforced in generate()).
  const rpcMethods = rpcServices.flatMap((s) =>
    s.methods.map((m) => ({ service: s, method: m })),
  );
  const rpcInterface = rpcServices.length
    ? `\
/** Typed rpc methods; requests travel over WebRTC data channels to the robot. */
export interface RpcMethods {
${rpcMethods
  .map(
    ({ service, method }) => `\
  /** ${service.typeName}.${method.wireName} (channel base "${service.label}"). */
  ${method.localName}(
    request: MessageInitShape<typeof ${method.input.message}Schema>,
    options?: { timeoutMs?: number },
  ): Promise<${method.output.message}>;`,
  )
  .join("\n")}
}
`
    : "";
  const rpcWiring = rpcMethods
    .map(
      ({ service, method }) => `\
    ${method.localName}: async (request, options) =>
      fromBinary(
        ${method.output.message}Schema,
        await client.callRpc(
          "${service.label}",
          "${method.wireName}",
          toBinary(${method.input.message}Schema, create(${method.input.message}Schema, request)),
          options,
        ),
      ),`,
    )
    .join("\n");

  // Typed client: connectToSfu() returns the runtime's Proto4WebrtcClient
  // extended with one subscribeTo<Stream>() method per declared stream.
  const clientMethods = [
    ...dataStreams.map((s) => ({
      name: exportName(s.message),
      sig: `subscribeTo${exportName(s.message)}(onMessage: (msg: ${s.message}) => void${
        s.hasStamp ? ", options?: { dropOutOfOrder?: boolean }" : ""
      }): () => void;`,
      wire: s.hasStamp
        ? `(cb, options) => ${exportName(s.message)}.subscribe(client, cb, options)`
        : `(cb) => ${exportName(s.message)}.subscribe(client, cb)`,
    })),
    ...mediaStreams.map((s) => ({
      name: exportName(s.message),
      sig: `subscribeTo${exportName(s.message)}(onTrack: (track: MediaStreamTrack) => void): () => void;`,
      wire: `(cb) => ${exportName(s.message)}.subscribe(client, cb)`,
    })),
  ];
  const usageDoc = clientMethods.length
    ? `\n *     client.subscribeTo${clientMethods[0].name}((...) => { ... });`
    : rpcMethods.length
      ? `\n *     await client.rpc.${rpcMethods[0].method.localName}({ ... });`
      : "";
  const clientBlock =
    clientMethods.length || rpcMethods.length
      ? `\
/** Proto4WebrtcClient extended with the typed per-stream/rpc methods. */
export interface StreamsClient extends Proto4WebrtcClient {
${[
  ...clientMethods.map((m) => `  ${m.sig}`),
  ...(rpcServices.length ? ["  rpc: RpcMethods;"] : []),
].join("\n")}
}

/**
 * Connect to the SFU signaling endpoint (proto4webrtc/client's connectToSfu)
 * and attach the typed per-stream subscribe and rpc methods:
 *
 *     const client = await connectToSfu({ onConnectionState: setState });${usageDoc}
 */
export async function connectToSfu(
  options?: Proto4WebrtcClientOptions,
): Promise<StreamsClient> {
  const client = (await proto4webrtcConnect(options)) as StreamsClient;
${clientMethods
  .map(
    (m) =>
      `  client.subscribeTo${m.name} = ${m.wire};`,
  )
  .join("\n")}${
    rpcServices.length
      ? `\n  client.rpc = {\n${rpcWiring}\n  };`
      : ""
  }
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

import { ${
    rpcServices.length ? "create, fromBinary, toBinary" : "fromBinary"
  } } from "@bufbuild/protobuf";
${rpcServices.length ? 'import type { MessageInitShape } from "@bufbuild/protobuf";\n' : ""}\
import {
  connectToSfu as proto4webrtcConnect,
  type Proto4WebrtcClient,
  type Proto4WebrtcClientOptions,
} from "proto4webrtc/client";
export type { Proto4WebrtcClient, Proto4WebrtcClientOptions };
${importBlocks.join("\n")}
${subscribableInterface}
${[...dataBlocks, ...mediaBlocks].join("\n\n")}

${rpcInterface}
${clientBlock}`;
}
