#!/usr/bin/env node

import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_SCHEMA = "forward-dynatrace-systemd-install-plan/v1";

const RUNTIME_SOURCE_ENTRIES = [
  "package.json",
  "package-lock.json",
  "scripts",
  "schemas",
  "config",
  "shared",
  "deploy",
];

const CONFIG_TEMPLATES = [
  ["deploy/systemd/forward-connector.config.example.json", "/etc/forward-dynatrace/forward-connector.config.json", 0o640],
  ["deploy/systemd/forward-dynatrace.env.example", "/etc/forward-dynatrace/forward-dynatrace.env", 0o600],
  ["deploy/systemd/forward-handoff.env.example", "/etc/forward-dynatrace/forward-handoff.env", 0o600],
  ["deploy/systemd/forward-check-health.env.example", "/etc/forward-dynatrace/forward-check-health.env", 0o600],
];

const SYSTEMD_UNITS = [
  "forward-dynatrace-connector.service",
  "forward-dynatrace-connector.timer",
  "forward-dynatrace-handoff.service",
  "forward-dynatrace-check-health.service",
  "forward-dynatrace-check-health.timer",
];

const DIRECTORIES = [
  ["/opt/forward-dynatrace", 0o755],
  ["/etc/forward-dynatrace", 0o750],
  ["/var/lib/forward-dynatrace", 0o750],
  ["/var/log/forward-dynatrace", 0o750],
];

const REQUIRED_OPERATOR_INPUTS = [
  { path: "/etc/forward-dynatrace/handoff-write-token", kind: "secret-file", mode: "0600" },
  { path: "/etc/forward-dynatrace/handoff-read-token", kind: "secret-file", mode: "0600" },
  { path: "/etc/forward-dynatrace/dynatrace-platform.token", kind: "secret-file", mode: "0600" },
  { path: "/etc/forward-dynatrace/platform-token", kind: "optional-secret-file", mode: "0600" },
  { path: "/etc/forward-dynatrace/customer-dependencies.dql", kind: "customer-query", mode: "0640" },
];

const ACTIVATION_COMMANDS = [
  "id forward-dynatrace || useradd --system --home-dir /var/lib/forward-dynatrace --shell /usr/sbin/nologin forward-dynatrace",
  "chown -R forward-dynatrace:forward-dynatrace /var/lib/forward-dynatrace /var/log/forward-dynatrace",
  "cd /opt/forward-dynatrace && npm ci --omit=dev --ignore-scripts",
  "systemd-analyze verify /etc/systemd/system/forward-dynatrace-*.service /etc/systemd/system/forward-dynatrace-*.timer",
  "systemctl daemon-reload",
  "systemctl enable --now forward-dynatrace-handoff.service forward-dynatrace-connector.timer",
];

const usage = `
Stage the checked systemd runtime from an extracted importer release

Usage:
  node scripts/install-systemd-runtime.mjs [options]

Options:
  --source-dir path       Extracted importer release; default: repository root.
  --root path             Filesystem root to stage beneath; default: /.
  --output path           Optional JSON plan/report output.
  --apply                 Write the staged runtime and placeholder configuration.
  --replace-existing      Allow --apply to replace conflicting managed files.
  --help                  Show help.

Dry-run is the default. The installer never creates credentials or token files and
never invokes systemctl. Review and replace every placeholder, install the listed
operator inputs, then run the emitted activation commands under customer control.
`;

export const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (["--help", "--apply", "--replace-existing"].includes(value)) {
      args[value.slice(2)] = true;
      continue;
    }
    if (["--source-dir", "--root", "--output"].includes(value)) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}.`);
      args[value.slice(2)] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${value}`);
  }
  return args;
};

export const assertNode24 = (version = process.versions.node) => {
  if (Number.parseInt(version.split(".", 1)[0], 10) !== 24) {
    throw new Error(`The systemd installer requires Node 24; found ${version}.`);
  }
};

const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const modeText = (mode) => mode.toString(8).padStart(4, "0");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const logicalDestination = (value) => {
  if (!value.startsWith("/") || path.posix.normalize(value) !== value || value.includes("..")) {
    throw new Error(`Unsafe install destination: ${value}`);
  }
  return value;
};

const resolveDestination = (rootDir, destination) => {
  const normalizedRoot = path.resolve(rootDir);
  const resolved = path.resolve(normalizedRoot, `.${logicalDestination(destination)}`);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Install destination escapes root: ${destination}`);
  }
  return resolved;
};

const inspectPath = async (filePath) => {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const validateDestinationChain = async (rootDir, destination) => {
  const normalizedRoot = path.resolve(rootDir);
  const rootMetadata = await inspectPath(normalizedRoot);
  if (rootMetadata && (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink())) {
    throw new Error(`Install root must be a real directory: ${normalizedRoot}`);
  }
  if (!rootMetadata) return;
  const destinationPath = resolveDestination(normalizedRoot, destination);
  const segments = path.relative(normalizedRoot, destinationPath).split(path.sep).filter(Boolean);
  let current = normalizedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const metadata = await inspectPath(current);
    if (!metadata) return;
    if (metadata.isSymbolicLink()) {
      throw new Error(`Install destination path must not contain symlinks: ${current}`);
    }
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      throw new Error(`Install destination parent must be a directory: ${current}`);
    }
  }
};

const collectSource = async ({ sourceDir, relativePath, destinationBase, files }) => {
  const sourcePath = path.join(sourceDir, relativePath);
  const metadata = await inspectPath(sourcePath);
  if (!metadata) throw new Error(`Missing systemd install source: ${relativePath}`);
  if (metadata.isSymbolicLink()) throw new Error(`Systemd install source must not be a symlink: ${relativePath}`);
  if (metadata.isDirectory()) {
    const entries = (await readdir(sourcePath)).sort();
    for (const entry of entries) {
      await collectSource({
        sourceDir,
        relativePath: path.posix.join(relativePath, entry),
        destinationBase,
        files,
      });
    }
    return;
  }
  if (!metadata.isFile()) throw new Error(`Systemd install source must be a regular file: ${relativePath}`);
  files.push({
    source: relativePath,
    destination: path.posix.join(destinationBase, relativePath),
    mode: metadata.mode & 0o755,
  });
};

const addManagedFile = (files, source, destination, mode, operatorOwned = false) => {
  files.push({ source, destination: logicalDestination(destination), mode, operatorOwned });
};

const inspectManagedFile = async ({ sourceDir, rootDir, file, replaceExisting }) => {
  const sourcePath = path.join(sourceDir, file.source);
  const sourceMetadata = await inspectPath(sourcePath);
  if (!sourceMetadata?.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error(`Managed source must be a regular file: ${file.source}`);
  }
  await validateDestinationChain(rootDir, file.destination);
  const destinationPath = resolveDestination(rootDir, file.destination);
  const destinationMetadata = await inspectPath(destinationPath);
  const sourceBytes = await readFile(sourcePath);
  let action = "create";
  if (destinationMetadata) {
    if (destinationMetadata.isSymbolicLink() || !destinationMetadata.isFile()) {
      throw new Error(`Managed destination must be a regular file: ${file.destination}`);
    }
    const destinationBytes = await readFile(destinationPath);
    if (sourceBytes.equals(destinationBytes)) {
      action = "unchanged";
    } else if (file.operatorOwned) {
      action = "preserve";
    } else if (replaceExisting) {
      action = "replace";
    } else {
      throw new Error(
        `Managed destination differs: ${file.destination}; rerun with --replace-existing after review.`,
      );
    }
  }
  return { ...file, mode: modeText(file.mode), sha256: sha256(sourceBytes), action };
};

export const buildInstallPlan = async ({
  sourceDir = SCRIPT_ROOT,
  rootDir = "/",
  replaceExisting = false,
} = {}) => {
  const sourceRoot = path.resolve(sourceDir);
  const installRoot = path.resolve(rootDir);
  if (!path.isAbsolute(installRoot)) throw new Error("--root must be an absolute path.");
  const packageJson = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  if (packageJson.engines?.node !== ">=24.0.0 <25.0.0") {
    throw new Error("The extracted importer release must require Node >=24.0.0 <25.0.0.");
  }

  const files = [];
  for (const entry of RUNTIME_SOURCE_ENTRIES) {
    await collectSource({
      sourceDir: sourceRoot,
      relativePath: entry,
      destinationBase: "/opt/forward-dynatrace",
      files,
    });
  }
  for (const [source, destination, mode] of CONFIG_TEMPLATES) {
    addManagedFile(files, source, destination, mode, true);
  }
  for (const unit of SYSTEMD_UNITS) {
    addManagedFile(
      files,
      `deploy/systemd/${unit}`,
      `/etc/systemd/system/${unit}`,
      0o644,
    );
  }

  const destinations = new Set();
  for (const file of files) {
    logicalDestination(file.destination);
    if (destinations.has(file.destination)) throw new Error(`Duplicate managed destination: ${file.destination}`);
    destinations.add(file.destination);
  }
  const inspectedFiles = [];
  for (const file of files.sort((left, right) => left.destination.localeCompare(right.destination))) {
    inspectedFiles.push(await inspectManagedFile({
      sourceDir: sourceRoot,
      rootDir: installRoot,
      file,
      replaceExisting,
    }));
  }

  return {
    schemaVersion: PLAN_SCHEMA,
    status: "planned",
    sourceVersion: packageJson.version,
    sourceDir: sourceRoot,
    rootDir: installRoot,
    replaceExisting: Boolean(replaceExisting),
    activationReady: false,
    configurationStatus: "placeholders-require-operator-review",
    directories: DIRECTORIES.map(([destination, mode]) => ({ destination, mode: modeText(mode) })),
    files: inspectedFiles,
    requiredOperatorInputs: REQUIRED_OPERATOR_INPUTS,
    activationCommands: ACTIVATION_COMMANDS,
  };
};

const ensureDirectory = async (rootDir, destination, mode) => {
  const normalizedRoot = path.resolve(rootDir);
  await mkdir(normalizedRoot, { recursive: true, mode: 0o755 });
  const rootMetadata = await lstat(normalizedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`Install root must be a real directory: ${normalizedRoot}`);
  }
  const relative = path.relative(normalizedRoot, resolveDestination(normalizedRoot, destination));
  let current = normalizedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = await inspectPath(current);
    if (metadata) {
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`Install directory path is not a real directory: ${current}`);
      }
    } else {
      await mkdir(current, { mode });
    }
  }
  await chmod(resolveDestination(normalizedRoot, destination), mode);
};

const installFile = async ({ plan, file }) => {
  const sourcePath = path.join(plan.sourceDir, file.source);
  const destinationPath = resolveDestination(plan.rootDir, file.destination);
  const sourceBytes = await readFile(sourcePath);
  if (sha256(sourceBytes) !== file.sha256) {
    throw new Error(`Install source changed after plan creation: ${file.source}`);
  }
  const parent = path.posix.dirname(file.destination);
  const managedParent = plan.directories
    .filter((directory) =>
      parent === directory.destination || parent.startsWith(`${directory.destination}/`))
    .sort((left, right) => right.destination.length - left.destination.length)[0];
  await ensureDirectory(
    plan.rootDir,
    parent,
    managedParent ? Number.parseInt(managedParent.mode, 8) : 0o755,
  );
  const mode = Number.parseInt(file.mode, 8);
  if (file.action === "unchanged" || file.action === "preserve") {
    await chmod(destinationPath, mode);
    return;
  }
  const temporaryPath = `${destinationPath}.install-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, sourceBytes, { flag: "wx", mode });
  try {
    if (file.action === "create") {
      await link(temporaryPath, destinationPath);
      await rm(temporaryPath);
    } else if (file.action === "replace") {
      const destinationMetadata = await inspectPath(destinationPath);
      if (!destinationMetadata?.isFile() || destinationMetadata.isSymbolicLink()) {
        throw new Error(`Managed destination changed during install: ${file.destination}`);
      }
      await rename(temporaryPath, destinationPath);
    } else {
      throw new Error(`Unsupported install action: ${file.action}`);
    }
    await chmod(destinationPath, mode);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const applyInstallPlan = async (plan) => {
  if (plan?.schemaVersion !== PLAN_SCHEMA || plan.status !== "planned") {
    throw new Error("Invalid systemd install plan.");
  }
  for (const directory of plan.directories) {
    await ensureDirectory(plan.rootDir, directory.destination, Number.parseInt(directory.mode, 8));
  }
  for (const file of plan.files) await installFile({ plan, file });
  return {
    ...plan,
    status: "installed",
    installedAt: new Date().toISOString(),
  };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  assertNode24();
  const plan = await buildInstallPlan({
    sourceDir: args["source-dir"] || SCRIPT_ROOT,
    rootDir: args.root || "/",
    replaceExisting: Boolean(args["replace-existing"]),
  });
  const report = args.apply ? await applyInstallPlan(plan) : plan;
  const text = canonicalJson(report);
  if (args.output) {
    const outputPath = path.resolve(args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, text, { mode: 0o600 });
  }
  process.stdout.write(text);
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
