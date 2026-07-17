#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const usage = `
Dynatrace dependency row normalizer

Usage:
  node scripts/normalize-dynatrace-dependencies.mjs --input rows.json --output dependencies.json
  node scripts/normalize-dynatrace-dependencies.mjs --input rows.json

Reads DQL-shaped dependency rows and writes Forward dependency candidates. The
output is still Dynatrace-side data; Forward writes happen only through the
Forward-side importer or connector.
`;

const field = (row, names, fallback = "") => {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return fallback;
};

const numberField = (row, names, fallback = 0) => {
  const raw = field(row, names, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parsedBooleanFields = (row, names) => {
  const values = [];
  for (const name of names) {
    const value = row[name];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    if (typeof value === "boolean") {
      values.push({ name, value });
      continue;
    }
    const normalized = String(value).trim().toLowerCase();
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

const syntheticField = (row) => {
  const explicit = parsedBooleanFields(row, [
    "demo.synthetic",
    "demo.replay",
    "forward.dynatrace.seeded",
    "provenance.synthetic",
    "synthetic",
  ]);
  const implicitMarkers = [
    row["event.provider"] === "forward-dynatrace-demo",
    row["event.type"] === "com.forward.demo.dependency",
    row.owner === "dynatrace-demo",
    /^dynatrace-demo-/iu.test(String(row["dependency.id"] || row.id || "")),
  ];
  const hasSyntheticMarker = explicit.some(({ value }) => value) || implicitMarkers.some(Boolean);
  const hasLiveMarker = explicit.some(({ value }) => !value);
  if (hasSyntheticMarker && hasLiveMarker) {
    throw new Error("Dependency row contains conflicting live and synthetic provenance markers.");
  }
  if (hasSyntheticMarker) return true;
  if (hasLiveMarker) return false;
  return undefined;
};

const slug = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const normalizeCriticality = (value) => {
  const normalized = slug(value || "medium");
  if (normalized === "critical") {
    return "critical";
  }
  if (normalized === "high") {
    return "high";
  }
  return "medium";
};

const normalizeProtocol = (value) => {
  const normalized = slug(value || "tcp");
  return normalized === "udp" ? "udp" : "tcp";
};

const normalizeMappingState = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ready" || normalized === "review" || normalized === "needs-map") {
    return normalized;
  }
  if (normalized === "needs_map" || normalized === "needs map") {
    return "needs-map";
  }
  return "";
};

const mappingStateFor = ({ source, destination, protocol, port, serviceEntityId, confidence }) => {
  if (!source || !destination || !protocol || !port || !serviceEntityId) {
    return "needs-map";
  }
  if (confidence < 90) {
    return "review";
  }
  return "ready";
};

export const normalizeDynatraceRows = (rows) => {
  if (!Array.isArray(rows)) {
    throw new Error("Input must be a JSON array of Dynatrace dependency rows.");
  }

  return rows.map((row, index) => {
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
    const synthetic = syntheticField(row);
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
      ...(synthetic === undefined ? {} : { synthetic }),
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

const parseArgs = (argv) => {
  const args = {};
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

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!args.input) {
    throw new Error("Missing required --input path.");
  }

  const rows = JSON.parse(await readFile(args.input, "utf8"));
  const dependencies = normalizeDynatraceRows(rows);
  const text = JSON.stringify(dependencies, null, 2) + "\n";
  if (args.output) {
    await writeFile(args.output, text);
  } else {
    process.stdout.write(text);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
