import {
  createRequestTimeout,
  readErrorEnvelope,
  readJson
} from "../http/client";
import { parseAdminSongListResponse } from "./list-contract";
import type {
  AdminSongCreateResult,
  AdminSongInput,
  AdminSongListResponse,
  AdminSongOptions
} from "./types";

const ADMIN_REQUEST_TIMEOUT_MS = 8_000;

export class AdminSongClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | undefined
  ) {
    super(code);
    this.name = "AdminSongClientError";
  }
}

export async function fetchAdminSongOptions(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AdminSongOptions> {
  const request = createRequestTimeout(ADMIN_REQUEST_TIMEOUT_MS, signal);
  try {
    const response = await fetcher("/api/admin/songs/options", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: request.signal
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw clientError(response, payload);
    }
    if (!isOptions(payload)) {
      throw new AdminSongClientError("INVALID_RESPONSE", response.status);
    }
    return payload;
  } finally {
    request.clear();
  }
}

export async function fetchAdminSongs(
  input: Readonly<{
    query?: string;
    cursor?: string;
    limit?: number;
  }> = {},
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AdminSongListResponse> {
  const request = createRequestTimeout(ADMIN_REQUEST_TIMEOUT_MS, signal);
  const searchParams = new URLSearchParams();
  if (input.query !== undefined) {
    searchParams.set("query", input.query);
  }
  if (input.cursor !== undefined) {
    searchParams.set("cursor", input.cursor);
  }
  if (input.limit !== undefined) {
    searchParams.set("limit", String(input.limit));
  }
  const query = searchParams.toString();

  try {
    const response = await fetcher(
      `/api/admin/songs${query === "" ? "" : `?${query}`}`,
      {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: request.signal
      }
    );
    const payload = await readJson(response);
    if (!response.ok) {
      throw clientError(response, payload);
    }
    try {
      return parseAdminSongListResponse(payload);
    } catch {
      throw new AdminSongClientError("INVALID_RESPONSE", response.status);
    }
  } finally {
    request.clear();
  }
}

export async function createAdminSong(
  input: AdminSongInput,
  fetcher: typeof fetch = fetch
): Promise<AdminSongCreateResult> {
  const request = createRequestTimeout(ADMIN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher("/api/admin/songs", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-knf-request": "1"
      },
      body: JSON.stringify(input),
      signal: request.signal
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw clientError(response, payload);
    }
    if (!isCreateResult(payload)) {
      throw new AdminSongClientError("INVALID_RESPONSE", response.status);
    }
    return payload;
  } finally {
    request.clear();
  }
}

function clientError(response: Response, payload: unknown) {
  const error = readErrorEnvelope(payload);
  return new AdminSongClientError(
    error.code ?? "ADMIN_SONG_UNAVAILABLE",
    response.status
  );
}

function isOptions(value: unknown): value is AdminSongOptions {
  if (!isRecord(value)) return false;
  return (
    stringArray(value.alias_types) &&
    stringArray(value.availability_statuses) &&
    Array.isArray(value.providers) &&
    value.providers.every(
      (provider) =>
        isRecord(provider) &&
        typeof provider.id === "string" &&
        typeof provider.name === "string" &&
        typeof provider.country === "string"
    )
  );
}

function isCreateResult(value: unknown): value is AdminSongCreateResult {
  return (
    isRecord(value) &&
    isRecord(value.song) &&
    typeof value.song.id === "string" &&
    typeof value.song.display_title === "string" &&
    typeof value.song.canonical_artist === "string" &&
    typeof value.alias_count === "number" &&
    typeof value.karaoke_entry_count === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
