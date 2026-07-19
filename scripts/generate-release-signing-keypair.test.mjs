import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runScript = (script, args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
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

test("generates release signing keys that can sign and verify checksums", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-release-key-"));
  const keygen = await runScript("scripts/generate-release-signing-keypair.mjs", [
    "--output-dir",
    workdir,
  ]);
  assert.equal(keygen.code, 0, keygen.stderr);
  const keygenResult = JSON.parse(keygen.stdout);
  assert.match(keygenResult.publicKeySha256, /^[a-f0-9]{64}$/);
  assert.match(await readFile(keygenResult.privateKeyPath, "utf8"), /PRIVATE KEY/);
  assert.match(await readFile(keygenResult.publicKeyPath, "utf8"), /PUBLIC KEY/);
  assert.equal((await stat(keygenResult.privateKeyPath)).mode & 0o777, 0o600);

  const checksumsPath = path.join(workdir, "SHA256SUMS");
  const signaturePath = path.join(workdir, "SHA256SUMS.sig");
  const publicKeyOutput = path.join(workdir, "SHA256SUMS.pub");
  await writeFile(checksumsPath, "abc123  forward-dynatrace-app-v0.11.0.zip\n");

  const sign = await runScript("scripts/sign-release-checksums.mjs", [
    "--checksums",
    checksumsPath,
    "--private-key",
    keygenResult.privateKeyPath,
    "--signature",
    signaturePath,
    "--public-key-output",
    publicKeyOutput,
  ]);
  assert.equal(sign.code, 0, sign.stderr);
  assert.equal(JSON.parse(sign.stdout).publicKeyOutput, publicKeyOutput);

  const verify = await runScript("scripts/sign-release-checksums.mjs", [
    "--verify",
    "--checksums",
    checksumsPath,
    "--public-key",
    publicKeyOutput,
    "--signature",
    signaturePath,
  ]);
  assert.equal(verify.code, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).status, "verified");
});
