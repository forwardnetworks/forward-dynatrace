#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "forward-dynatrace-security-correlation/v1";
const CONFIDENCE = { low: 1, medium: 2, high: 3 };
const FINDING_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

const usage = `
Dynatrace and Forward security exposure correlator

  node scripts/security-exposure-correlation.mjs \\
    --dynatrace-findings dynatrace-findings.json \\
    --forward-exposures forward-exposures.json \\
    --identity-mappings identity-mappings.json \\
    --evidence-source customer-approved-export \\
    --output security-correlation.json

Options:
  --evidence-source label  Publish-safe provenance label (required).
  --synthetic              Explicitly label demo/synthetic evidence.

This command reads evidence files and writes a ranked investigation queue. It
does not contact or mutate Dynatrace or Forward. Low-confidence mappings never
produce a high-severity result.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") { args.help = true; continue; }
    if (value === "--synthetic") { args.synthetic = true; continue; }
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    args[value.slice(2)] = next;
    index += 1;
  }
  return args;
};

const required = (args, key) => {
  if (!args[key]) throw new Error(`Missing required option: --${key}`);
  return args[key];
};
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const asArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
};
const severityScore = { low: 1, medium: 2, high: 3, critical: 4 };
const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
};
const isoDate = (value, label) => {
  const normalized = nonEmptyString(value, label);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO date-time.`);
  }
  return normalized;
};
const booleanValue = (value, label) => {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
};
const assertUniqueIds = (items, key, label) => {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const id = nonEmptyString(item?.[key], `${label}[${index}].${key}`);
    if (seen.has(id)) throw new Error(`${label} contains duplicate ${key}: ${id}.`);
    seen.add(id);
  }
};

export const validateSecurityInputs = ({ findings, exposures, mappings }) => {
  asArray(findings, "Dynatrace findings");
  asArray(exposures, "Forward exposures");
  asArray(mappings, "Identity mappings");
  assertUniqueIds(findings, "findingId", "Dynatrace findings");
  assertUniqueIds(exposures, "exposureId", "Forward exposures");
  assertUniqueIds(mappings, "mappingId", "Identity mappings");
  findings.forEach((finding, index) => {
    isoDate(finding.observedAt, `Dynatrace findings[${index}].observedAt`);
    if (!FINDING_SEVERITIES.has(finding.severity)) {
      throw new Error(`Dynatrace findings[${index}].severity is unsupported.`);
    }
    booleanValue(finding.activeExecution, `Dynatrace findings[${index}].activeExecution`);
  });
  exposures.forEach((exposure, index) => {
    nonEmptyString(exposure.snapshotId, `Forward exposures[${index}].snapshotId`);
    isoDate(exposure.observedAt, `Forward exposures[${index}].observedAt`);
    for (const key of ["modeledReachable", "internetAddressable", "policyFinding"]) {
      booleanValue(exposure[key], `Forward exposures[${index}].${key}`);
    }
  });
  mappings.forEach((mapping, index) => {
    nonEmptyString(mapping.findingId, `Identity mappings[${index}].findingId`);
    nonEmptyString(mapping.exposureId, `Identity mappings[${index}].exposureId`);
    if (!CONFIDENCE[mapping.confidence]) {
      throw new Error(`Identity mappings[${index}].confidence is unsupported.`);
    }
    if (mapping.owner !== undefined && mapping.owner !== null) {
      nonEmptyString(mapping.owner, `Identity mappings[${index}].owner`);
    }
  });
  return { findings, exposures, mappings };
};

const validateProvenance = (provenance = {}) => {
  const source = nonEmptyString(provenance.source || "unspecified", "Evidence source");
  if (source.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(source)) {
    throw new Error("Evidence source must be a publish-safe label up to 128 characters.");
  }
  return { source, synthetic: Boolean(provenance.synthetic) };
};

const rankSeverity = (finding, exposure, confidence) => {
  const score = (severityScore[finding.severity] || 1)
    + (finding.activeExecution ? 2 : 0)
    + (exposure.internetAddressable ? 2 : 0)
    + (exposure.modeledReachable ? 2 : 0);
  if (confidence !== "high") return score >= 5 ? "medium" : "low";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
};

export const correlateSecurityExposure = ({
  findings,
  exposures,
  mappings,
  generatedAt,
  provenance,
}) => {
  validateSecurityInputs({ findings, exposures, mappings });
  const findingsById = new Map(findings.map((item) => [item.findingId, item]));
  const exposuresById = new Map(exposures.map((item) => [item.exposureId, item]));
  const queue = [];
  const rejectedMappings = [];
  for (const mapping of mappings) {
    const finding = findingsById.get(mapping.findingId);
    const exposure = exposuresById.get(mapping.exposureId);
    if (!finding || !exposure || !CONFIDENCE[mapping.confidence]) {
      rejectedMappings.push({ mappingId: mapping.mappingId, reason: "missing-evidence-or-invalid-confidence" });
      continue;
    }
    const severity = rankSeverity(finding, exposure, mapping.confidence);
    queue.push({
      correlationId: hash(`${mapping.mappingId}:${finding.findingId}:${exposure.exposureId}`),
      severity,
      confidence: mapping.confidence,
      owner: mapping.owner || null,
      evidence: {
        dynatraceFindingId: finding.findingId,
        dynatraceObservedAt: finding.observedAt,
        forwardExposureId: exposure.exposureId,
        forwardSnapshotId: exposure.snapshotId,
        forwardObservedAt: exposure.observedAt,
        identityMappingId: mapping.mappingId,
      },
      facts: {
        observedExecution: Boolean(finding.activeExecution),
        vulnerableRuntime: true,
        modeledReachability: Boolean(exposure.modeledReachable),
        internetAddressability: Boolean(exposure.internetAddressable),
        policyFinding: Boolean(exposure.policyFinding),
      },
      disposition: mapping.confidence === "low" ? "identity-review-required" : "investigate",
    });
  }
  queue.sort((left, right) =>
    (severityScore[right.severity] - severityScore[left.severity]) || left.correlationId.localeCompare(right.correlationId));
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    mode: "read-only-investigation",
    provenance: validateProvenance(provenance),
    counts: {
      findings: findings.length,
      exposures: exposures.length,
      mappings: mappings.length,
      correlated: queue.length,
      rejectedMappings: rejectedMappings.length,
    },
    investigationQueue: queue,
    rejectedMappings,
    boundaries: {
      rawEvidenceRemainsInSourceSystems: true,
      modeledReachabilityIsNotPolicyIntent: true,
      automaticRemediation: false,
    },
  };
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) return process.stdout.write(usage);
  const artifact = correlateSecurityExposure({
    findings: await readJson(required(args, "dynatrace-findings")),
    exposures: await readJson(required(args, "forward-exposures")),
    mappings: await readJson(required(args, "identity-mappings")),
    generatedAt: new Date().toISOString(),
    provenance: {
      source: required(args, "evidence-source"),
      synthetic: Boolean(args.synthetic),
    },
  });
  const output = path.resolve(required(args, "output"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(artifact.counts, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
