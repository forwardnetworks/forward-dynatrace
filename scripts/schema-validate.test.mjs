import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runSchemaValidate = async (args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/schema-validate.mjs", ...args], {
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
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${process.execPath} scripts/schema-validate.mjs exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });

test("validates committed examples and generated demo package", async () => {
  const result = await runSchemaValidate();
  assert.equal(result.status, "ok");
  assert.ok(result.validated >= 10);
  assert.ok(result.artifacts.includes("shared/demo-forward-ingest-status.json"));
});

test("rejects connector configs that contain secret-shaped keys", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "forward-dynatrace-bad-schema-"));
  const configPath = path.join(tempDir, "bad-config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: "forward-dynatrace-connector/v1",
        forwardPassword: "do-not-store",
      },
      null,
      2,
    )}\n`,
  );

  await assert.rejects(
    runSchemaValidate(["--connector-config", configPath]),
    /failed schema validation/,
  );
});
