import {
  AutomationCodeEditor,
  AutomationConnectionPicker,
} from "@dynatrace/automation-action-components";
import { FormField, Label } from "@dynatrace/strato-components-preview/forms";
import { type ActionWidget } from "@dynatrace-sdk/automation-action-utils";
import React from "react";

interface RunForwardNqeEvidenceWidgetInput {
  connectionId: string;
  request: string;
}

const defaultRequest = JSON.stringify(
  {
    forwardAccessProfile: "read-only",
    templateId: "approved-library-query",
    queryId: "FQ_<approved-library-query-id>",
    parameters: {},
    maxRows: 25,
  },
  null,
  2,
);

const RunForwardNqeEvidenceWidget: ActionWidget<RunForwardNqeEvidenceWidgetInput> = ({
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
      <Label>Forward NQE request</Label>
      <AutomationCodeEditor
        aria-label="Forward NQE request JSON or workflow expression"
        language="json"
        value={value.request || defaultRequest}
        onChange={(request) => onValueChanged({ ...value, request })}
        maxHeight={480}
      />
    </FormField>
  </>
);

export default RunForwardNqeEvidenceWidget;
