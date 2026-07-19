import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "scripts/write-release-checksums.mjs");

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

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("writes sha256sum-compatible release checksums", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-checksums-"));
  const first = path.join(workdir, "app.zip");
  const second = path.join(workdir, "sbom.json");
  const output = path.join(workdir, "SHA256SUMS");
  await writeFile(first, "app bytes\n");
  await writeFile(second, "sbom bytes\n");

  const result = await runScript(["--output", output, first, second]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    await readFile(output, "utf8"),
    [
      `${sha256("app bytes\n")}  app.zip`,
      `${sha256("sbom bytes\n")}  sbom.json`,
      "",
    ].join("\n"),
  );
});

test("rejects duplicate artifact basenames", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-checksums-"));
  const firstDir = path.join(workdir, "first");
  const secondDir = path.join(workdir, "second");
  await Promise.all([mkdir(firstDir), mkdir(secondDir)]);
  const first = path.join(firstDir, "artifact.zip");
  const second = path.join(secondDir, "artifact.zip");
  await Promise.all([writeFile(first, "one"), writeFile(second, "two")]);

  const result = await runScript(["--output", path.join(workdir, "SHA256SUMS"), first, second]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Duplicate artifact filename/);
});
