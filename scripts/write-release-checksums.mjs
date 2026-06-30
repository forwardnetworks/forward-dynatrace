#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const usage = `
Release checksum writer

Usage:
  node scripts/write-release-checksums.mjs --output dist/SHA256SUMS artifact...

Writes SHA-256 checksums in sha256sum-compatible format.
`;

const parseArgs = (argv) => {
  const args = { artifacts: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--output") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --output.");
      }
      args.output = next;
      index += 1;
      continue;
    }
    if (value.startsWith("--")) {
      throw new Error(`Unsupported option: ${value}`);
    }
    args.artifacts.push(value);
  }
  return args;
};

const sha256File = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args.output) {
    throw new Error("Missing required --output path.");
  }
  if (args.artifacts.length === 0) {
    throw new Error("At least one release artifact is required.");
  }

  const seenNames = new Set();
  const lines = [];
  for (const artifactPath of args.artifacts) {
    const details = await stat(artifactPath);
    if (!details.isFile()) {
      throw new Error(`Release artifact is not a file: ${artifactPath}`);
    }
    const artifactName = path.basename(artifactPath);
    if (seenNames.has(artifactName)) {
      throw new Error(`Duplicate artifact filename would make checksums ambiguous: ${artifactName}`);
    }
    seenNames.add(artifactName);
    lines.push(`${await sha256File(artifactPath)}  ${artifactName}`);
  }

  await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await writeFile(args.output, `${lines.join("\n")}\n`);
  process.stdout.write(`Wrote ${lines.length} checksum(s) to ${args.output}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
