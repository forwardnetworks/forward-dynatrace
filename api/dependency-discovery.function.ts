import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings-v2";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";

import {
  PROFILE_SCHEMA_ID,
  discoveryConfigurationMessage,
  normalizeDiscoveryRows,
  selectDiscoveryProfile,
} from "../lib/dependency-discovery.mjs";

interface DependencyDiscoveryRequest {
  profileId?: string;
}

interface DiscoveryProfile {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  query: string;
  maxResultRecords: number;
  maxEvidenceAgeMinutes: number;
}

interface DiscoverySelection {
  profile: DiscoveryProfile | null;
  profiles: Array<Pick<DiscoveryProfile, "id" | "name" | "description" | "isDefault">>;
  reason: string | null;
}

interface DependencyDiscoveryResponse {
  status: "ready" | "configuration-required" | "blocked";
  summary: string;
  selectedProfile: { id: string; name: string } | null;
  profiles: Array<{ id: string; name: string; description: string; isDefault: boolean }>;
  dependencies: Array<Record<string, unknown>>;
  evidence: {
    queriedRows: number;
    acceptedRows: number;
    rejectedRows: number;
    newestObservedAt: string | null;
    sources: string[];
    runIds: string[];
  } | null;
  rejectedRows: Array<{ row: number; reason: string }>;
  nextSteps: string[];
}

const terminalStates = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "RESULT_GONE"]);

const runQuery = async (query: string, maxResultRecords: number) => {
  let response = await queryExecutionClient.queryExecute({
    body: {
      query,
      defaultScanLimitGbytes: 5,
      enablePreview: false,
      enforceQueryConsumptionLimit: true,
      fetchTimeoutSeconds: 30,
      maxResultBytes: 2_000_000,
      maxResultRecords,
      pollingPromiseSeconds: 30,
      requestTimeoutMilliseconds: 30_000,
    },
    dtClientContext: "forward-dependency-discovery",
  });

  for (let attempt = 0; !terminalStates.has(response.state) && attempt < 6; attempt += 1) {
    if (!response.requestToken) throw new Error("Dynatrace query did not return a polling token.");
    response = await queryExecutionClient.queryPoll({
      requestToken: response.requestToken,
      requestTimeoutMilliseconds: 10_000,
      dtClientContext: "forward-dependency-discovery",
    });
  }

  if (response.state !== "SUCCEEDED" || !response.result) {
    throw new Error(`Dynatrace dependency query ended in state ${response.state}.`);
  }
  return response.result.records.filter(
    (record): record is Record<string, unknown> => Boolean(record),
  );
};

const emptyEvidence = null;

const safeErrorSummary = (error: unknown) => {
  if (!(error instanceof Error)) return "Dependency discovery failed.";
  if (/^(?:Dependency discovery (?:profile|query)|Maximum (?:result records|evidence age minutes)|Dynatrace (?:query did not return|dependency query ended in state))/u.test(error.message)) {
    return error.message.slice(0, 500);
  }
  return "Dynatrace dependency discovery failed before returning a sanitized result. Review the profile query in a Notebook.";
};

export default async function (
  payload?: DependencyDiscoveryRequest,
): Promise<DependencyDiscoveryResponse> {
  try {
    const objects = await appSettingsObjectsClient.getAppSettingsObjects({
      schemaId: PROFILE_SCHEMA_ID,
      addFields: "objectId,schemaId,summary,value",
      pageSize: 100,
    });
    if (objects.error) throw new Error("Dynatrace returned an incomplete discovery profile list.");

    const selected = selectDiscoveryProfile(
      objects.items || [],
      payload?.profileId?.trim(),
    ) as DiscoverySelection;
    if (!selected.profile) {
      const summary = discoveryConfigurationMessage(selected.reason) as string;
      return {
        status: "configuration-required",
        summary,
        selectedProfile: null,
        profiles: selected.profiles,
        dependencies: [],
        evidence: emptyEvidence,
        rejectedRows: [],
        nextSteps: [
          "Open Settings > Apps > Dependency discovery profile.",
          "Use a reviewed spans-only DQL query that returns the documented canonical fields.",
          "Mark exactly one enabled profile as default or select a profile in the app.",
        ],
      };
    }

    const records = await runQuery(selected.profile.query, selected.profile.maxResultRecords);
    const normalized = normalizeDiscoveryRows(records, {
      maxEvidenceAgeMinutes: selected.profile.maxEvidenceAgeMinutes,
    });
    const dependencies = normalized.dependencies as Array<Record<string, unknown>>;
    const rejectedRows = normalized.rejected as Array<{ row: number; reason: string }>;
    const hasAcceptedRows = dependencies.length > 0;

    return {
      status: hasAcceptedRows ? "ready" : "blocked",
      summary: hasAcceptedRows
        ? `Loaded ${dependencies.length} current trace-backed dependencies from ${selected.profile.name}.`
        : "The selected profile returned no current eligible dependency rows.",
      selectedProfile: { id: selected.profile.id, name: selected.profile.name },
      profiles: selected.profiles,
      dependencies,
      evidence: normalized.evidence,
      rejectedRows: rejectedRows.slice(0, 50),
      nextSteps: hasAcceptedRows
        ? [
            "Review mapping readiness before building a Forward plan.",
            "Treat rejected rows as fail-closed mapping follow-up.",
          ]
        : [
            "Verify the profile query against current spans and its evidence window.",
            "Populate real endpoint, protocol, port, ownership, and evidence-time fields.",
            "Do not add seeded or replay fallback rows.",
          ],
    };
  } catch (error) {
    return {
      status: "blocked",
      summary: safeErrorSummary(error),
      selectedProfile: null,
      profiles: [],
      dependencies: [],
      evidence: emptyEvidence,
      rejectedRows: [],
      nextSteps: [
        "Review the tenant-owned discovery profile and Workflow/app permissions.",
        "Keep the query spans-only and bounded to current evidence.",
      ],
    };
  }
}
