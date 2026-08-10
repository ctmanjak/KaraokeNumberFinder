type ErrorRecord = Readonly<Record<string, unknown>>;

const ERROR_LINK_KEYS = ["cause", "meta", "driverAdapterError"] as const;
const MAX_ERROR_NODES = 12;

export function hasPrismaErrorCode(
  error: unknown,
  codes: readonly string[]
): boolean {
  const accepted = new Set(codes);
  return someErrorRecord(
    error,
    (record) => typeof record.code === "string" && accepted.has(record.code)
  );
}

export function isPrismaTransactionWriteConflict(error: unknown): boolean {
  return someErrorRecord(
    error,
    (record) =>
      record.kind === "TransactionWriteConflict" ||
      record.code === "P2034" ||
      record.originalCode === "40001" ||
      record.originalCode === "40P01"
  );
}

export function isPostgresStatementTimeout(error: unknown): boolean {
  return someErrorRecord(
    error,
    (record) =>
      record.code === "57014" ||
      record.originalCode === "57014" ||
      (record.kind === "postgres" && record.code === "57014")
  );
}

function someErrorRecord(
  error: unknown,
  predicate: (record: ErrorRecord) => boolean
): boolean {
  const queue: unknown[] = [error];
  const visited = new Set<object>();

  for (
    let index = 0;
    index < queue.length && index < MAX_ERROR_NODES;
    index += 1
  ) {
    const current = queue[index];
    if (!isErrorRecord(current) || visited.has(current)) {
      continue;
    }
    visited.add(current);
    if (predicate(current)) {
      return true;
    }
    for (const key of ERROR_LINK_KEYS) {
      const linked = current[key];
      if (isErrorRecord(linked) && !visited.has(linked)) {
        queue.push(linked);
      }
    }
  }
  return false;
}

function isErrorRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null;
}
