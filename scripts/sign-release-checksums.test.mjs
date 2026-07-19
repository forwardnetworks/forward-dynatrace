import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "scripts/sign-release-checksums.mjs");

const runScript = (args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

const writeKeys = async (workdir) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(workdir, "release-private.pem");
  const publicKeyPath = path.join(workdir, "release-public.pem");
  await writeFile(privateKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }));
  await writeFile(publicKeyPath, publicKey.export({ format: "pem", type: "spki" }));
  return { privateKeyPath, publicKeyPath };
};

test("signs and verifies release checksums", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-release-sign-"));
  const checksumsPath = path.join(workdir, "SHA256SUMS");
  const signaturePath = path.join(workdir, "SHA256SUMS.sig");
  const publicKeyOutputPath = path.join(workdir, "SHA256SUMS.pub");
  const { privateKeyPath, publicKeyPath } = await writeKeys(workdir);
  await writeFile(checksumsPath, "abc123  forward-dynatrace-app-v0.11.0.zip\n");

  const signResult = await runScript([
    "--checksums",
    checksumsPath,
    "--private-key",
    privateKeyPath,
    "--signature",
    signaturePath,
    "--public-key-output",
    publicKeyOutputPath,
  ]);
  assert.equal(signResult.code, 0, signResult.stderr);
  const signSummary = JSON.parse(signResult.stdout);
  assert.equal(signSummary.status, "signed");
  assert.equal(signSummary.publicKeyOutput, publicKeyOutputPath);
  assert.match(await readFile(signaturePath, "utf8"), /^[A-Za-z0-9+/=]+\n$/);
  assert.equal(await readFile(publicKeyOutputPath, "utf8"), await readFile(publicKeyPath, "utf8"));

  const verifyResult = await runScript([
    "--verify",
    "--checksums",
    checksumsPath,
    "--public-key",
    publicKeyPath,
    "--signature",
    signaturePath,
  ]);
  assert.equal(verifyResult.code, 0, verifyResult.stderr);
  assert.equal(JSON.parse(verifyResult.stdout).status, "verified");
});

test("rejects checksum tampering", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-release-sign-"));
  const checksumsPath = path.join(workdir, "SHA256SUMS");
  const signaturePath = path.join(workdir, "SHA256SUMS.sig");
  const { privateKeyPath, publicKeyPath } = await writeKeys(workdir);
  await writeFile(checksumsPath, "abc123  forward-dynatrace-app-v0.11.0.zip\n");

  const signResult = await runScript([
    "--checksums",
    checksumsPath,
    "--private-key",
    privateKeyPath,
    "--signature",
    signaturePath,
  ]);
  assert.equal(signResult.code, 0, signResult.stderr);
  await writeFile(checksumsPath, "def456  forward-dynatrace-app-v0.11.0.zip\n");

  const verifyResult = await runScript([
    "--verify",
    "--checksums",
    checksumsPath,
    "--public-key",
    publicKeyPath,
    "--signature",
    signaturePath,
  ]);
  assert.equal(verifyResult.code, 1);
  assert.match(verifyResult.stderr, /verification failed/);
});
