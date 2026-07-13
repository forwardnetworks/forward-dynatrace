export type ChangeOutcomeRecord = Record<string, unknown>;

const stringField = (record: ChangeOutcomeRecord, name: string): string => {
  const value = record[name];
  return typeof value === "string" ? value.trim() : "";
};

const nonNegativeIntegerField = (
  record: ChangeOutcomeRecord,
  name: string,
): boolean => {
  const value = record[name];
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0;
};

export const isBoundChangeOutcome = (record: ChangeOutcomeRecord): boolean => {
  const decision = stringField(record, "forward.dynatrace.gate_decision").toLowerCase();
  const checksum = stringField(record, "forward.dynatrace.servicenow_evidence_sha256");
  const idempotencyKey = stringField(record, "forward.dynatrace.servicenow_idempotency_key");
  const evidenceSource = stringField(record, "forward.dynatrace.evidence_source");
  const synthetic = record["forward.dynatrace.synthetic"];
  const requiredEvidenceFields = [
    "forward.dynatrace.gate_run_id",
    "forward.dynatrace.change_id",
    "forward.dynatrace.network_id",
    "forward.dynatrace.before_snapshot_id",
    "forward.dynatrace.after_snapshot_id",
    "forward.dynatrace.service_health",
  ];

  return (
    (decision === "pass" || decision === "fail") &&
    /^[a-f0-9]{64}$/iu.test(checksum) &&
    idempotencyKey === `forward-dynatrace:${checksum}` &&
    evidenceSource.length > 0 &&
    typeof synthetic === "boolean" &&
    requiredEvidenceFields.every((name) => stringField(record, name).length > 0) &&
    nonNegativeIntegerField(record, "forward.dynatrace.before_reachable") &&
    nonNegativeIntegerField(record, "forward.dynatrace.after_reachable")
  );
};

export const selectBoundChangeOutcomes = (
  records: ChangeOutcomeRecord[],
): ChangeOutcomeRecord[] => {
  const pair = ["pass", "fail"].flatMap((decision) => {
    const record = records.find(
      (candidate) =>
        isBoundChangeOutcome(candidate) &&
        stringField(candidate, "forward.dynatrace.gate_decision").toLowerCase() === decision,
    );
    return record ? [record] : [];
  });
  return pair.length === 2 ? pair : [];
};
