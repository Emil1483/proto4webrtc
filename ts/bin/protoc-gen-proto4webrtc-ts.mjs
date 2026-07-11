#!/usr/bin/env node
// protoc plugin entry point: CodeGeneratorRequest on stdin,
// CodeGeneratorResponse on stdout.
import { runPlugin } from "../src/plugin.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
process.stdout.write(runPlugin(Buffer.concat(chunks)));
