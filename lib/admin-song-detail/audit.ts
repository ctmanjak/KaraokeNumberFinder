import type { AdminCatalogHandlerCompletion } from "../admin-catalog/guard";
import type { AdminSongUpdateCounts } from "./types";

const ZERO_COUNTS: AdminSongUpdateCounts = {
  song_fields: 0,
  aliases_added: 0,
  aliases_updated: 0,
  aliases_deleted: 0,
  karaoke_entries_added: 0,
  karaoke_entries_updated: 0
};

export type AdminSongUpdateAuditEvent = Readonly<{
  event: "admin_song.update";
  occurred_at: string;
  request_id: string;
  actor_user_id: string | null;
  target_song_id: string | null;
  outcome: "success" | "rejected" | "failed";
  http_status: number;
  error_code?: string;
  change_counts: AdminSongUpdateCounts;
}>;

export type WriteAdminSongUpdateAuditEvent = (
  event: AdminSongUpdateAuditEvent
) => void;

export function createAdminSongUpdateAuditCompletion(
  targetSongId: string | undefined,
  writer: WriteAdminSongUpdateAuditEvent = defaultAuditWriter,
  now: () => Date = () => new Date()
) {
  return async (completion: AdminCatalogHandlerCompletion): Promise<void> => {
    const payload = await safeJson(completion.response);
    const errorCode = readErrorCode(payload);
    const counts = completion.response.ok
      ? readChangeCounts(payload)
      : ZERO_COUNTS;
    const event: AdminSongUpdateAuditEvent = {
      event: "admin_song.update",
      occurred_at: now().toISOString(),
      request_id: completion.requestId,
      actor_user_id: completion.actorUserId ?? null,
      target_song_id: targetSongId ?? null,
      outcome: completion.response.ok
        ? "success"
        : completion.response.status >= 500
          ? "failed"
          : "rejected",
      http_status: completion.response.status,
      ...(errorCode === undefined ? {} : { error_code: errorCode }),
      change_counts: counts
    };
    try {
      writer(event);
    } catch {
      console.error("[admin-song] Update audit sink failed.");
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
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "code" in value.error &&
    typeof value.error.code === "string"
  ) {
    return value.error.code;
  }
  return undefined;
}

function readChangeCounts(value: unknown): AdminSongUpdateCounts {
  if (
    typeof value === "object" &&
    value !== null &&
    "change_counts" in value &&
    isChangeCounts(value.change_counts)
  ) {
    return value.change_counts;
  }
  return ZERO_COUNTS;
}

function isChangeCounts(value: unknown): value is AdminSongUpdateCounts {
  return (
    typeof value === "object" &&
    value !== null &&
    [
      "song_fields",
      "aliases_added",
      "aliases_updated",
      "aliases_deleted",
      "karaoke_entries_added",
      "karaoke_entries_updated"
    ].every(
      (key) =>
        key in value &&
        typeof (value as Record<string, unknown>)[key] === "number"
    )
  );
}

function defaultAuditWriter(event: AdminSongUpdateAuditEvent): void {
  console.info("[admin-song] Song update audit.", {
    ...event,
    actor_user_id: event.actor_user_id === null ? null : "[redacted]"
  });
}
