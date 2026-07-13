#!/usr/bin/env node

import { spawn } from "node:child_process";

const commands = new Map([
  ["forward-import", "scripts/forward-import-package.mjs"],
  ["forward-package-publish", "scripts/publish-forward-package.mjs"],
  ["forward-handoff-server", "scripts/forward-handoff-server.mjs"],
  ["forward-check-health", "scripts/forward-check-health-transitions.mjs"],
  ["security-correlate", "scripts/security-exposure-correlation.mjs"],
  ["dynatrace-security-publish", "scripts/publish-dynatrace-security-correlation.mjs"],
  ["servicenow-change-preflight", "scripts/servicenow-change-preflight.mjs"],
  ["servicenow-scope-resolve", "scripts/resolve-servicenow-scope.mjs"],
  ["servicenow-change-feedback", "scripts/servicenow-change-feedback.mjs"],
  ["servicenow-change-assurance", "scripts/servicenow-change-assurance.mjs"],
  ["servicenow-change-workflow", "scripts/servicenow-change-workflow.mjs"],
  ["servicenow-flow-server", "scripts/servicenow-flow-server.mjs"],
]);

export const resolveRuntimeCommand = (argv) => {
  const [candidate, ...rest] = argv;
  if (commands.has(candidate)) return { script: commands.get(candidate), args: rest };
  return { script: commands.get("forward-import"), args: argv };
};

const main = () => {
  const command = resolveRuntimeCommand(process.argv.slice(2));
  const child = spawn(process.execPath, [command.script, ...command.args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("close", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
};

if (import.meta.url === `file://${process.argv[1]}`) main();
