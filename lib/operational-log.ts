export type OperationalLogLevel = "info" | "warn";

export interface OperationalLogFields {
  status: "ready" | "blocked";
  durationMs: number;
  reasonCode?: string;
  httpStatusClass?: string;
  forwardAccessProfile?: string;
  snapshotState?: "PROCESSED";
}

export interface OperationalLogRecord extends OperationalLogFields {
  schemaVersion: "forward-dynatrace-operational-log/v1";
  timestamp: string;
  event: string;
  correlationId: string;
}

export type OperationalLogWriter = (
  level: OperationalLogLevel,
  record: OperationalLogRecord,
) => void;

export const defaultOperationalLogWriter: OperationalLogWriter = (level, record) => {
  const serialized = JSON.stringify(record);
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.info(serialized);
};

export const writeOperationalLog = ({
  level,
  event,
  correlationId,
  fields,
  now = () => new Date(),
  writer = defaultOperationalLogWriter,
}: {
  level: OperationalLogLevel;
  event: string;
  correlationId: string;
  fields: OperationalLogFields;
  now?: () => Date;
  writer?: OperationalLogWriter;
}): void => {
  writer(level, {
    schemaVersion: "forward-dynatrace-operational-log/v1",
    timestamp: now().toISOString(),
    event,
    correlationId,
    ...fields,
  });
};
