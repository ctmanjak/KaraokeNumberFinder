import type { AdminCatalogHandlerCompletion } from "../admin-catalog/guard";
import type { AdminSongCreateCounts } from "./types";

const ZERO_COUNTS: AdminSongCreateCounts = {
  songs: 0,
  administrator_aliases: 0,
  karaoke_entries: 0
};

export type AdminSongCreateAuditEvent = Readonly<{
  event: "admin_song.create";
  occurred_at: string;
  request_id: string;
  actor_user_id?: string;
  target_song_id?: string;
  outcome: "accepted" | "rejected" | "failed";
  http_status: number;
  error_code?: string;
  created_counts: AdminSongCreateCounts;
}>;

export type WriteAdminSongCreateAuditEvent = (
  event: AdminSongCreateAuditEvent
) => void;

export function createAdminSongCreateAuditCompletion(
  writer: WriteAdminSongCreateAuditEvent = defaultAuditWriter,
  now: () => Date = () => new Date()
) {
  return async (completion: AdminCatalogHandlerCompletion): Promise<void> => {
    const payload = await safeJson(completion.response);
    const songId = completion.response.ok ? readSongId(payload) : undefined;
    const errorCode = readErrorCode(payload);
    const event: AdminSongCreateAuditEvent = {
      event: "admin_song.create",
      occurred_at: now().toISOString(),
      request_id: completion.requestId,
      ...(completion.actorUserId === undefined
        ? {}
        : { actor_user_id: completion.actorUserId }),
      ...(songId === undefined ? {} : { target_song_id: songId }),
      outcome: completion.response.ok
        ? "accepted"
        : completion.response.status >= 500
          ? "failed"
          : "rejected",
      http_status: completion.response.status,
      ...(errorCode === undefined ? {} : { error_code: errorCode }),
      created_counts: completion.response.ok
        ? readCreateCounts(payload)
        : ZERO_COUNTS
    };
    try {
      writer(event);
    } catch {
      console.error("[admin-song] Create audit sink failed.");
    }
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readErrorCode(value: unknown): string | undefined {
  if (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string"
  ) {
    return value.error.code;
  }
  return undefined;
}

function readSongId(value: unknown): string | undefined {
  return isRecord(value) &&
    isRecord(value.song) &&
    typeof value.song.id === "string"
    ? value.song.id
    : undefined;
}

function readCreateCounts(value: unknown): AdminSongCreateCounts {
  if (
    isRecord(value) &&
    isRecord(value.created_counts) &&
    value.created_counts.songs === 1 &&
    typeof value.created_counts.administrator_aliases === "number" &&
    typeof value.created_counts.karaoke_entries === "number"
  ) {
    return {
      songs: 1,
      administrator_aliases: value.created_counts.administrator_aliases,
      karaoke_entries: value.created_counts.karaoke_entries
    };
  }
  return ZERO_COUNTS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultAuditWriter(event: AdminSongCreateAuditEvent): void {
  console.info("[admin-song] Song create audit.", event);
}
