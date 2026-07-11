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

  const dataBlocks = dataStreams.map(
    (s) => `\
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
   * Typed wrapper over Proto4WebrtcSfu.subscribe() (npm package
   * "proto4webrtc"): in-process, no browser, no WebRTC. Decodes automatically.
   */
  subscribe(
    sfu: Proto4WebrtcSubscribable,
    onMessage: (msg: ${s.message}) => void,
  ): () => void {
    return sfu.subscribe(this.label, (data) => onMessage(this.decode(data)));
  },
} as const;`,
  );

  const mediaBlocks = mediaStreams.map(
    (s) => `\
/** Media stream "${s.label}" (${s.kind}); track arrives over RTP. */
export const ${exportName(s.message)} = {
  label: "${s.label}",
  kind: "${s.kind}",
} as const;`,
  );

  // A local structural type, not an import of the real Proto4WebrtcSfu class
  // (npm package "proto4webrtc") — so browser-only consumers (attach() against
  // a real mediasoup-client DataConsumer) never need that package installed
  // just to typecheck this file. The real class satisfies this structurally.
  const subscribableInterface = dataStreams.length
    ? `\ninterface Proto4WebrtcSubscribable {
  subscribe(label: string, onMessage: (data: Uint8Array) => void): () => void;
}\n`
    : "";

  return `// Generated by protoc-gen-proto4webrtc-ts. Do not edit.
//
// Typed mediasoup consumer wrappers for the streams declared in the
// protofiles. Pages look up a data producer by \`label\`, consume it, then:
//
//     TelemetryStream.attach(dataConsumer, (msg) => { ... });
//
// Server-side, in-process (no browser, no WebRTC), against a
// Proto4WebrtcSfu (npm package "proto4webrtc"):
//
//     TelemetryStream.subscribe(sfu, (msg) => { ... });

import { fromBinary } from "@bufbuild/protobuf";
${importBlocks.join("\n")}
${subscribableInterface}
${[...dataBlocks, ...mediaBlocks].join("\n\n")}
`;
}
