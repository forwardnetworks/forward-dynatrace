import {
  AutomationCodeEditor,
  AutomationConnectionPicker,
} from "@dynatrace/automation-action-components";
import { Button } from "@dynatrace/strato-components/buttons";
import { Paragraph, Strong } from "@dynatrace/strato-components/typography";
import { FormField, Label } from "@dynatrace/strato-components-preview/forms";
import { type ActionWidget } from "@dynatrace-sdk/automation-action-utils";
import React from "react";

interface SyncForwardIntentChecksWidgetInput {
  connectionId: string;
  request: string;
  requestDraft: string;
}

const defaultRequest = JSON.stringify(
  {
    sourceInstanceId: "<dynatrace-source-instance-id>",
    syncMode: "direct-api",
    forwardAccessProfile: "read-only",
    operation: "plan",
    approvalMode: "digest",
    maxCreates: 1000,
    maxUpdates: 100,
    runPathPreflight: true,
    approvedPlanDigest: "",
    approvedSourceKeys: [],
    dependencies: [],
  },
  null,
  2,
);

type RequestOperation = "plan" | "apply" | "unknown";
const MAX_CREATE_BUDGET = 2_500;
const MAX_UPDATE_BUDGET = 1_000;

interface ApplyReview {
  approvalMode: string;
  digest: string;
  maxCreates: string;
  maxUpdates: string;
  pathPreflight: string;
  partition: string;
  sourceKeys: string;
  stageable: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requestOperation = (request: string): RequestOperation => {
  try {
    const parsed = JSON.parse(request) as unknown;
    if (isRecord(parsed) && (parsed.operation === "plan" || parsed.operation === "apply")) {
      return parsed.operation;
    }
  } catch {
    if (/['\"]operation['\"]\s*:\s*['\"]apply['\"]/u.test(request)) return "apply";
    if (/['\"]operation['\"]\s*:\s*['\"]plan['\"]/u.test(request)) return "plan";
  }
  return "unknown";
};

const applyReview = (request: string): ApplyReview => {
  try {
    const parsed = JSON.parse(request) as unknown;
    if (isRecord(parsed)) {
      const approvedDigest = parsed.approvedPlanDigest;
      const approvedKeys = parsed.approvedSourceKeys;
      const approvalMode = parsed.approvalMode ?? "digest";
      const approvalNonce = parsed.approvalNonce;
      const applyKeys = parsed.applySourceKeys;
      const maxCreates = parsed.maxCreates;
      const maxUpdates = parsed.maxUpdates;
      const expression = (value: unknown): boolean =>
        typeof value === "string" && value.includes("{{");
      return {
        approvalMode: typeof approvalMode === "string"
          ? approvalMode
          : "workflow expression or missing",
        digest: typeof approvedDigest === "string"
          ? approvedDigest
          : "workflow expression or missing",
        maxCreates: typeof maxCreates === "number"
          ? String(maxCreates)
          : "workflow expression or missing",
        maxUpdates: typeof maxUpdates === "number"
          ? String(maxUpdates)
          : "workflow expression or missing",
        pathPreflight: parsed.runPathPreflight === true ? "required" : "not confirmed",
        partition: Array.isArray(applyKeys)
          ? `${applyKeys.length} selected update key(s)`
          : "full changed set",
        sourceKeys: Array.isArray(approvedKeys)
          ? `${approvedKeys.length} exact changed key(s)`
          : "workflow expression or missing",
        stageable:
          (typeof approvedDigest === "string" &&
            (/^[a-f0-9]{64}$/u.test(approvedDigest) || expression(approvedDigest))) &&
          ((typeof maxCreates === "number" && Number.isInteger(maxCreates) &&
            maxCreates >= 0 && maxCreates <= MAX_CREATE_BUDGET) ||
            expression(maxCreates)) &&
          ((typeof maxUpdates === "number" && Number.isInteger(maxUpdates) &&
            maxUpdates >= 0 && maxUpdates <= MAX_UPDATE_BUDGET) ||
            expression(maxUpdates)) &&
          parsed.runPathPreflight === true &&
          (approvalMode === "digest" ||
            (approvalMode === "engine-approval" &&
              (typeof approvalNonce === "string" &&
                (approvalNonce.length > 0 || expression(approvalNonce))))) &&
          (applyKeys === undefined ||
            (Array.isArray(applyKeys) &&
              applyKeys.every((key) => typeof key === "string"))) &&
          ((Array.isArray(approvedKeys) && approvedKeys.every((key) => typeof key === "string")) ||
            expression(approvedKeys)),
      };
    }
  } catch {
    // Workflow expressions are evaluated by Automation at execution time.
  }
  const pathPreflightRequired = /['\"]runPathPreflight['\"]\s*:\s*true/u.test(request);
  return {
    approvalMode: "resolved from workflow expression at execution",
    digest: "resolved from workflow expression at execution",
    maxCreates: "resolved from workflow expression at execution",
    maxUpdates: "resolved from workflow expression at execution",
    pathPreflight: pathPreflightRequired ? "required" : "not confirmed",
    partition: "resolved from workflow expression at execution",
    sourceKeys: "resolved from workflow expression at execution",
    stageable: pathPreflightRequired,
  };
};

const SyncForwardIntentChecksWidget: ActionWidget<SyncForwardIntentChecksWidgetInput> = ({
  value,
  onValueChanged,
}) => {
  const activeRequest = value.request || defaultRequest;
  const draftRequest = value.requestDraft ?? activeRequest;
  const draftOperation = requestOperation(draftRequest);
  const review = draftOperation === "apply" ? applyReview(draftRequest) : null;
  const updateDraft = (requestDraft: string) => onValueChanged({
    ...value,
    request: requestOperation(activeRequest) === "apply" ? defaultRequest : activeRequest,
    requestDraft,
  });

  return (
    <>
      <FormField>
        <Label>Forward API connection</Label>
        <AutomationConnectionPicker
          connectionId={value.connectionId}
          schema="forward-api-connection"
          onChange={(connectionId) => onValueChanged({ ...value, connectionId })}
        />
      </FormField>
      <FormField>
        <Label>Forward synchronization request draft</Label>
        <AutomationCodeEditor
          aria-label="Forward synchronization request JSON or workflow expression draft"
          language="json"
          value={draftRequest}
          onChange={updateDraft}
          maxHeight={480}
        />
      </FormField>
      {draftOperation === "apply" && review ? (
        <FormField>
          <Label>Exact approval review</Label>
          <Paragraph>
            <Strong>Apply is mutating.</Strong> Confirm this draft uses the current plan digest, the
            complete changed-source-key set, approved mutation budgets, and required path preflight.
          </Paragraph>
          <Paragraph>
            Digest: {review.digest}; creates: {review.maxCreates}; updates: {review.maxUpdates};
            path preflight: {review.pathPreflight}; authorization: {review.approvalMode};
            apply scope: {review.partition}; approved keys: {review.sourceKeys}.
          </Paragraph>
        </FormField>
      ) : (
        <Paragraph>
          Plan is non-mutating. Run it first and review collisions, stale rows, changed source keys,
          path evidence, budgets, and the resulting digest before drafting apply.
        </Paragraph>
      )}
      <Button
        color="primary"
        variant={draftOperation === "apply" ? "emphasized" : "accent"}
        disabled={draftOperation === "unknown" || (review !== null && !review.stageable)}
        onClick={() => onValueChanged({
          ...value,
          request: draftRequest,
          requestDraft: undefined,
        })}
      >
        {draftOperation === "apply"
          ? "Stage exact-approved apply request"
          : "Use staged plan request"}
      </Button>
      {draftOperation === "unknown" && (
        <Paragraph>
          Set a literal operation of plan or apply before staging this request.
        </Paragraph>
      )}
      {review !== null && !review.stageable && (
        <Paragraph>
          Apply cannot be staged until the digest, bounded non-negative budgets, required path
          preflight, and complete changed-source-key array are present.
        </Paragraph>
      )}
    </>
  );
};

export default SyncForwardIntentChecksWidget;
