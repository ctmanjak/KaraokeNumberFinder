import {
  createRequestTimeout,
  readErrorEnvelope,
  readJson
} from "../http/client";
import { AdminSongClientError } from "../admin-song/client";
import type {
  AdminSongDetail,
  AdminSongPatchInput,
  AdminSongPatchResult
} from "./types";

const DETAIL_TIMEOUT_MS = 8_000;

export async function fetchAdminSongDetail(
  songId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AdminSongDetail> {
  const timeout = createRequestTimeout(DETAIL_TIMEOUT_MS, signal);
  try {
    const response = await fetcher(
      `/api/admin/songs/${encodeURIComponent(songId)}`,
      {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: timeout.signal
      }
    );
    const payload = await readJson(response);
    if (!response.ok) throw detailClientError(response, payload);
    if (!isDetail(payload)) {
      throw new AdminSongClientError("INVALID_RESPONSE", response.status);
    }
    return payload;
  } finally {
    timeout.clear();
  }
}

export async function updateAdminSongDetail(
  songId: string,
  input: AdminSongPatchInput,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AdminSongPatchResult> {
  const timeout = createRequestTimeout(DETAIL_TIMEOUT_MS, signal);
  try {
    const response = await fetcher(
      `/api/admin/songs/${encodeURIComponent(songId)}`,
      {
        method: "PATCH",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-knf-request": "1"
        },
        body: JSON.stringify(input),
        signal: timeout.signal
      }
    );
    const payload = await readJson(response);
    if (!response.ok) throw detailClientError(response, payload);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("detail" in payload) ||
      !isDetail(payload.detail) ||
      !("change_counts" in payload)
    ) {
      throw new AdminSongClientError("INVALID_RESPONSE", response.status);
    }
    return payload as AdminSongPatchResult;
  } finally {
    timeout.clear();
  }
}

function detailClientError(response: Response, payload: unknown) {
  const error = readErrorEnvelope(payload);
  return new AdminSongClientError(
    error.code ?? "ADMIN_SONG_UNAVAILABLE",
    response.status,
    payload,
    response.headers.get("retry-after")
  );
}

function isDetail(value: unknown): value is AdminSongDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    "song" in value &&
    typeof value.song === "object" &&
    value.song !== null &&
    "id" in value.song &&
    typeof value.song.id === "string" &&
    "updated_at" in value.song &&
    typeof value.song.updated_at === "string" &&
    "system_aliases" in value &&
    Array.isArray(value.system_aliases) &&
    "aliases" in value &&
    Array.isArray(value.aliases) &&
    "karaoke_entries" in value &&
    Array.isArray(value.karaoke_entries) &&
    "limits" in value
  );
}
