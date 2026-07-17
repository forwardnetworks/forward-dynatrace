#!/usr/bin/env node

import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const usage = `
Forward for Dynatrace release signing key generator

Usage:
  node scripts/generate-release-signing-keypair.mjs \\
    --output-dir /secure/path/forward-dynatrace-release-signing

Options:
  --output-dir path   Directory for release-ed25519-private.pem and release-ed25519-public.pem.
  --private-key path  Private-key output path. Defaults under --output-dir.
  --public-key path   Public-key output path. Defaults under --output-dir.

The private key must stay outside the repository. Store it in the release system
secret manager, for example GitHub Actions secret RELEASE_SIGNING_PRIVATE_KEY_PEM.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--output-dir" || value === "--private-key" || value === "--public-key") {
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

const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

export const generateReleaseSigningKeypair = async ({
  outputDir,
  privateKeyPath,
  publicKeyPath,
}) => {
  const effectiveOutputDir = outputDir || process.cwd();
  const effectivePrivateKeyPath =
    privateKeyPath || path.join(effectiveOutputDir, "release-ed25519-private.pem");
  const effectivePublicKeyPath =
    publicKeyPath || path.join(effectiveOutputDir, "release-ed25519-public.pem");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });

  await mkdir(path.dirname(effectivePrivateKeyPath), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(effectivePublicKeyPath), { recursive: true, mode: 0o700 });
  await writeFile(effectivePrivateKeyPath, privateKeyPem, { mode: 0o600 });
  await writeFile(effectivePublicKeyPath, publicKeyPem, { mode: 0o644 });

  return {
    privateKeyPath: effectivePrivateKeyPath,
    publicKeyPath: effectivePublicKeyPath,
    publicKeySha256: sha256Hex(publicKeyPem),
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  if (!args["output-dir"] && (!args["private-key"] || !args["public-key"])) {
    throw new Error("Use --output-dir or provide both --private-key and --public-key.");
  }

  const result = await generateReleaseSigningKeypair({
    outputDir: args["output-dir"],
    privateKeyPath: args["private-key"],
    publicKeyPath: args["public-key"],
  });
  process.stdout.write(
    JSON.stringify(
      {
        status: "created",
        privateKeyPath: result.privateKeyPath,
        publicKeyPath: result.publicKeyPath,
        publicKeySha256: result.publicKeySha256,
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
