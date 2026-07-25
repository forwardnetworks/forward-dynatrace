#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import type {
  DependencyCandidate,
  DependencyCriticality,
} from "../lib/types/forward.ts";

type DependencyMappingState = "ready" | "review" | "needs-map";

type DynatraceRow = Record<string, unknown>;

interface NormalizerArgs {
  [key: string]: string | true | undefined;
  help?: true;
  input?: string;
  output?: string;
}

const isRecord = (value: unknown): value is DynatraceRow =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const scalarText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";

const usage = `
Dynatrace dependency row normalizer

Usage:
  node scripts/normalize-dynatrace-dependencies.mjs --input rows.json --output dependencies.json
  node scripts/normalize-dynatrace-dependencies.mjs --input rows.json

Reads DQL-shaped dependency rows and writes Forward dependency candidates. The
output is still Dynatrace-side data; Forward writes happen only through the
Dynatrace app backend before direct Forward API synchronization.
`;

const field = (row: DynatraceRow, names: string[], fallback = ""): string => {
  for (const name of names) {
    const value = row[name];
    const text = scalarText(value).trim();
    if (text) {
      return text;
    }
  }
  return fallback;
};

const numberField = (row: DynatraceRow, names: string[], fallback = 0): number => {
  const raw = field(row, names, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parsedBooleanFields = (
  row: DynatraceRow,
  names: string[],
): Array<{ name: string; value: boolean }> => {
  const values: Array<{ name: string; value: boolean }> = [];
  for (const name of names) {
    const value = row[name];
    if (value === undefined || value === null || scalarText(value).trim() === "") continue;
    if (typeof value === "boolean") {
      values.push({ name, value });
      continue;
    }
    const normalized = scalarText(value).trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      values.push({ name, value: true });
      continue;
    }
    if (normalized === "false" || normalized === "0") {
      values.push({ name, value: false });
      continue;
    }
    throw new Error(`${name} must be a boolean when supplied.`);
  }
  return values;
};

const requireLiveProvenance = (row: DynatraceRow): void => {
  const explicit = parsedBooleanFields(row, [
    "evidence.synthetic",
    "evidence.replay",
    "forward.dynatrace.seeded",
    "provenance.synthetic",
    "synthetic",
  ]);
  const implicitMarkers = [
    row["event.provider"] === "forward-dynatrace-replay",
    row["event.type"] === "com.forward.replay.dependency",
    row.owner === "replay-evidence",
    /^replay-evidence-/iu.test(scalarText(row["dependency.id"] || row.id)),
  ];
  const hasNonLiveMarker = explicit.some(({ value }) => value) || implicitMarkers.some(Boolean);
  if (hasNonLiveMarker) {
    throw new Error("Dependency row is replay, seeded, fixture, or synthetic evidence; live-only normalization rejected it.");
  }
};

const slug = (value: unknown): string =>
  scalarText(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const normalizeCriticality = (value: unknown): DependencyCriticality => {
  const normalized = slug(value || "medium");
  if (normalized === "critical") {
    return "critical";
  }
  if (normalized === "high") {
    return "high";
  }
  return "medium";
};

const normalizeProtocol = (value: unknown): "tcp" | "udp" => {
  const normalized = slug(value || "tcp");
  return normalized === "udp" ? "udp" : "tcp";
};

const normalizeMappingState = (value: unknown): DependencyMappingState | "" => {
  const normalized = scalarText(value).trim().toLowerCase();
  if (normalized === "ready" || normalized === "review" || normalized === "needs-map") {
    return normalized;
  }
  if (normalized === "needs_map" || normalized === "needs map") {
    return "needs-map";
  }
  return "";
};

const mappingStateFor = ({
  source,
  destination,
  protocol,
  port,
  serviceEntityId,
  confidence,
}: {
  source: string;
  destination: string;
  protocol: "tcp" | "udp";
  port: string;
  serviceEntityId: string;
  confidence: number;
}): DependencyMappingState => {
  if (!source || !destination || !protocol || !port || !serviceEntityId) {
    return "needs-map";
  }
  if (confidence < 90) {
    return "review";
  }
  return "ready";
};

export const normalizeDynatraceRows = (rows: unknown): DependencyCandidate[] => {
  if (!Array.isArray(rows)) {
    throw new Error("Input must be a JSON array of Dynatrace dependency rows.");
  }

  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`Dynatrace dependency row ${index + 1} must be an object.`);
    }
    requireLiveProvenance(row);
    const appName = field(row, ["app.name", "appName", "application"], "unknown-app");
    const environment = field(row, ["app.environment", "environment", "env"], "unknown");
    const serviceEntityId = field(row, ["dt.entity.service", "serviceEntityId", "service.id"]);
    const serviceName = field(row, ["service.name", "serviceName"], serviceEntityId || "unknown-service");
    const sourceLabel = field(row, ["network.source.label", "sourceLabel"]);
    const source = field(row, ["network.source", "source", "source.host", "source.ip"]);
    const destinationLabel = field(row, ["network.destination.label", "destinationLabel"]);
    const destination = field(row, [
      "network.destination",
      "destination",
      "destination.host",
      "destination.ip",
    ]);
    const protocol = normalizeProtocol(field(row, ["network.protocol", "protocol"], "tcp"));
    const port = field(row, ["network.port", "port", "destination.port"]);
    const explicitMappingState = normalizeMappingState(
      field(row, ["dependency.mapping_state", "mappingState", "mapping.state"]),
    );
    const owner = field(row, ["owner.team", "owner", "team"], "unknown-owner");
    const criticality = normalizeCriticality(field(row, ["criticality", "business.criticality"], "medium"));
    const confidence = numberField(row, ["dependency.confidence", "confidence", "mapping.confidence"], 0);
    const id = field(
      row,
      ["dependency.id", "id"],
      [
        slug(appName),
        slug(environment),
        slug(serviceEntityId || serviceName),
        slug(source || `source-${index + 1}`),
        slug(destination || `destination-${index + 1}`),
        protocol,
        slug(port || "unknown-port"),
      ]
        .filter(Boolean)
        .join("-"),
    );

    return {
      id,
      appName,
      environment,
      serviceEntityId,
      serviceName,
      ...(sourceLabel ? { sourceLabel } : {}),
      source,
      ...(destinationLabel ? { destinationLabel } : {}),
      destination,
      protocol,
      port,
      owner,
      criticality,
      confidence,
      mappingState:
        explicitMappingState ||
        mappingStateFor({
          source,
          destination,
          protocol,
          port,
          serviceEntityId,
          confidence,
        }),
    };
  });
};

const parseArgs = (argv: string[]): NormalizerArgs => {
  const args: NormalizerArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      args.help = true;
      continue;
    }
    if (value === "--input" || value === "--output") {
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

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args.input) {
    throw new Error("Missing required --input path.");
  }

  const rows: unknown = JSON.parse(await readFile(args.input, "utf8"));
  const dependencies = normalizeDynatraceRows(rows);
  const text = JSON.stringify(dependencies, null, 2) + "\n";
  if (args.output) {
    await writeFile(args.output, text);
  } else {
    process.stdout.write(text);
  }
};

if (process.argv[1] && (
  import.meta.url === pathToFileURL(process.argv[1]).href ||
  process.argv[1].endsWith("/normalize-dynatrace-dependencies.mjs")
)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Dependency normalization failed."}\n`);
    process.exit(1);
  });
}
