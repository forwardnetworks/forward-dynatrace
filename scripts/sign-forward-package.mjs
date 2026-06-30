#!/usr/bin/env node

import { sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { packageSigningPayload } from "./forward-import-package.mjs";

const usage = `
Forward Dynatrace package signer

Usage:
  node scripts/sign-forward-package.mjs \\
    --checks forward-intent-checks.json \\
    --manifest forward-dynatrace-manifest.json \\
    --private-key /secure/path/ed25519-private.pem \\
    --signature forward-dynatrace-package.sig

The private key must stay outside the repo.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unsupported positional argument: ${value}`);
    }
    const key = value.slice(2);
    if (key === "help") {
      args.help = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = next;
    index += 1;
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) {
    throw new Error(`Missing required option: --${key}`);
  }
  return args[key];
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const checksText = await readFile(required(args, "checks"), "utf8");
  const manifestText = await readFile(required(args, "manifest"), "utf8");
  const privateKeyText = await readFile(required(args, "private-key"), "utf8");
  const signature = sign(
    null,
    Buffer.from(packageSigningPayload({ checksText, manifestText }), "utf8"),
    privateKeyText,
  ).toString("base64");

  await writeFile(required(args, "signature"), `${signature}\n`);
  process.stdout.write(
    JSON.stringify(
      {
        signature: args.signature,
        status: "signed",
      },
      null,
      2,
    ) + "\n",
  );
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write(usage);
    process.exit(1);
  });
}
