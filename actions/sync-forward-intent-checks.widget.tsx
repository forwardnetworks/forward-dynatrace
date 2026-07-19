import {
  AutomationCodeEditor,
  AutomationConnectionPicker,
} from "@dynatrace/automation-action-components";
import { FormField, Label } from "@dynatrace/strato-components-preview/forms";
import { type ActionWidget } from "@dynatrace-sdk/automation-action-utils";
import React from "react";

interface SyncForwardIntentChecksWidgetInput {
  connectionId: string;
  request: string;
}

const defaultRequest = JSON.stringify(
  {
    sourceInstanceId: "<dynatrace-source-instance-id>",
    syncMode: "direct-api",
    forwardAccessProfile: "read-only",
    operation: "plan",
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

const SyncForwardIntentChecksWidget: ActionWidget<SyncForwardIntentChecksWidgetInput> = ({
  value,
  onValueChanged,
}) => (
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
      <Label>Forward synchronization request</Label>
      <AutomationCodeEditor
        aria-label="Forward synchronization request JSON or workflow expression"
        language="json"
        value={value.request || defaultRequest}
        onChange={(request) => onValueChanged({ ...value, request })}
        maxHeight={480}
      />
    </FormField>
  </>
);

export default SyncForwardIntentChecksWidget;
