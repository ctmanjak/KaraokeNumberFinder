import { createHash } from "node:crypto";

const CURSOR_VERSION = 2;
const MAX_CURSOR_LENGTH = 1_024;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PRECISE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

export type AdminSongCursorKey = Readonly<{
  updatedAt: string;
  id: string;
}>;

type EncodedAdminSongCursor = Readonly<{
  v: typeof CURSOR_VERSION;
  updated_at: string;
  id: string;
  scope: string;
}>;

export class InvalidAdminSongCursorError extends Error {
  constructor() {
    super("INVALID_ADMIN_SONG_CURSOR");
    this.name = "InvalidAdminSongCursorError";
  }
}

export function encodeAdminSongCursor(
  key: AdminSongCursorKey,
  normalizedQuery: string | null
): string {
  if (
    !isAdminSongCursorTimestamp(key.updatedAt) ||
    key.id.length === 0 ||
    key.id.length > 128
  ) {
    invalidCursor();
  }
  const payload: EncodedAdminSongCursor = {
    v: CURSOR_VERSION,
    updated_at: key.updatedAt,
    id: key.id,
    scope: cursorScope(normalizedQuery)
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeAdminSongCursor(
  cursor: string,
  normalizedQuery: string | null
): AdminSongCursorKey {
  if (
    cursor.length === 0 ||
    cursor.length > MAX_CURSOR_LENGTH ||
    !CURSOR_PATTERN.test(cursor)
  ) {
    invalidCursor();
  }

  let decoded: string;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) {
      invalidCursor();
    }
    decoded = bytes.toString("utf8");
  } catch {
    invalidCursor();
  }

  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    invalidCursor();
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["v", "updated_at", "id", "scope"])
  ) {
    invalidCursor();
  }

  if (
    value.v !== CURSOR_VERSION ||
    typeof value.updated_at !== "string" ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    typeof value.scope !== "string" ||
    value.scope !== cursorScope(normalizedQuery)
  ) {
    invalidCursor();
  }

  if (!isAdminSongCursorTimestamp(value.updated_at)) {
    invalidCursor();
  }
  return { updatedAt: value.updated_at, id: value.id };
}

export function isAdminSongCursorTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !PRECISE_UTC_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const millisecondTimestamp = value.replace(/(\.\d{3})\d{3}Z$/u, "$1Z");
  const parsed = new Date(millisecondTimestamp);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === millisecondTimestamp
  );
}

function cursorScope(normalizedQuery: string | null): string {
  return createHash("sha256")
    .update(normalizedQuery ?? "", "utf8")
    .digest("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function invalidCursor(): never {
  throw new InvalidAdminSongCursorError();
}
