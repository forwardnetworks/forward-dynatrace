import {
  AutomationCodeEditor,
  AutomationConnectionPicker,
} from "@dynatrace/automation-action-components";
import { Button } from "@dynatrace/strato-components/buttons";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { FormField, Label } from "@dynatrace/strato-components-preview/forms";
import { type ActionWidget } from "@dynatrace-sdk/automation-action-utils";
import React from "react";

interface RunForwardNqeEvidenceWidgetInput {
  connectionId: string;
  request: string;
}

const libraryRequest = JSON.stringify(
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

const arbitraryRequest = JSON.stringify(
  {
    forwardAccessProfile: "network-operator",
    query: "<reviewed-arbitrary-nqe-query>",
    approvedQueryDigest: "<approved-query-digest>",
    maxRows: 25,
  },
  null,
  2,
);

const resumeRequest = JSON.stringify(
  {
    forwardAccessProfile: "network-operator",
    executionKey: "X_<server-issued-execution-key>",
    maxRows: 25,
  },
  null,
  2,
);

const RunForwardNqeEvidenceWidget: ActionWidget<RunForwardNqeEvidenceWidgetInput> = ({
  value,
  onValueChanged,
}) => {
  const setRequest = (request: string) => onValueChanged({ ...value, request });

  return <>
    <FormField>
      <Label>Forward API connection</Label>
      <AutomationConnectionPicker
        connectionId={value.connectionId}
        schema="forward-api-connection"
        onChange={(connectionId) => onValueChanged({ ...value, connectionId })}
      />
    </FormField>
    <FormField>
      <Label>Request shape</Label>
      <Button color="primary" size="condensed" onClick={() => setRequest(libraryRequest)}>
        Approved Library query
      </Button>
      <Button color="primary" size="condensed" onClick={() => setRequest(arbitraryRequest)}>
        Reviewed arbitrary query
      </Button>
      <Button color="primary" size="condensed" onClick={() => setRequest(resumeRequest)}>
        Resume async execution
      </Button>
      <Paragraph>
        Async execution is the default. Arbitrary query text requires the approved 64-hex sha256 of
        its trimmed, whitespace-collapsed text and a matching connection allowlist entry. Resume
        with only the server-issued executionKey and compatible common fields; do not resubmit query
        text.
      </Paragraph>
    </FormField>
    <FormField>
      <Label>Forward NQE request</Label>
      <AutomationCodeEditor
        aria-label="Forward NQE request JSON or workflow expression"
        language="json"
        value={value.request || libraryRequest}
        onChange={(request) => onValueChanged({ ...value, request })}
        maxHeight={480}
      />
    </FormField>
  </>;
};

export default RunForwardNqeEvidenceWidget;
