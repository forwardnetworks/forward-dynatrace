import { AutomationCodeEditor } from "@dynatrace/automation-action-components";
import { FormField, Label } from "@dynatrace/strato-components-preview/forms";
import { type ActionWidget } from "@dynatrace-sdk/automation-action-utils";
import React from "react";

interface ExportForwardPackageWidgetInput {
  request: string;
}

const defaultRequest = JSON.stringify(
  {
    syncMode: "data-connector",
    forwardNetworkId: "<network-id>",
    dependencies: [],
  },
  null,
  2,
);

const ExportForwardPackageWidget: ActionWidget<ExportForwardPackageWidgetInput> = ({
  value,
  onValueChanged,
}) => (
  <FormField>
    <Label>Forward package request</Label>
    <AutomationCodeEditor
      aria-label="Forward package request JSON or workflow expression"
      language="json"
      value={value.request || defaultRequest}
      onChange={(request) => onValueChanged({ ...value, request })}
      maxHeight={480}
    />
  </FormField>
);

export default ExportForwardPackageWidget;

