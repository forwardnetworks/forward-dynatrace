#!/usr/bin/env node

import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const usage = `
Forward Integration for Dynatrace release checksum signer

Sign:
  node scripts/sign-release-checksums.mjs \\
    --checksums SHA256SUMS \\
    --private-key /secure/path/release-ed25519-private.pem \\
    --signature SHA256SUMS.sig \\
    --public-key-output SHA256SUMS.pub

Verify:
  node scripts/sign-release-checksums.mjs \\
    --verify \\
    --checksums SHA256SUMS \\
    --public-key /secure/path/release-ed25519-public.pem \\
    --signature SHA256SUMS.sig

The release signing key must stay outside the repo and should be separate from
Forward intent-package signing keys.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--verify") {
      args.verify = true;
      continue;
    }
    if (
      value === "--checksums" ||
      value === "--private-key" ||
      value === "--public-key" ||
      value === "--signature" ||
      value === "--public-key-output"
    ) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${value}.`);
      }
      args[value.slice(2)] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${value}`);
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) {
    throw new Error(`Missing required option: --${key}`);
  }
  return args[key];
};

const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

export const releaseSigningPayload = (checksumsText) =>
  [
    "forward-dynatrace-release-signature/v1",
    `sha256sums-sha256:${sha256Hex(checksumsText)}`,
    "",
  ].join("\n");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const checksumsText = await readFile(required(args, "checksums"), "utf8");
  const signaturePath = required(args, "signature");
  const payload = Buffer.from(releaseSigningPayload(checksumsText), "utf8");

  if (args.verify) {
    const publicKeyText = await readFile(required(args, "public-key"), "utf8");
    const signatureText = (await readFile(signaturePath, "utf8")).trim();
    const ok = verify(
      null,
      payload,
      publicKeyText,
      Buffer.from(signatureText, "base64"),
    );
    if (!ok) {
      throw new Error("Release checksum signature verification failed.");
    }
    process.stdout.write(
      JSON.stringify(
        {
          status: "verified",
          checksums: args.checksums,
          signature: signaturePath,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const privateKeyText = await readFile(required(args, "private-key"), "utf8");
  const signature = sign(null, payload, privateKeyText).toString("base64");
  await writeFile(signaturePath, `${signature}\n`);
  if (args["public-key-output"]) {
    const publicKeyPem = createPublicKey(privateKeyText).export({
      format: "pem",
      type: "spki",
    });
    await writeFile(args["public-key-output"], publicKeyPem);
  }
  process.stdout.write(
    JSON.stringify(
      {
        status: "signed",
        checksums: args.checksums,
        signature: signaturePath,
        publicKeyOutput: args["public-key-output"] || null,
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
