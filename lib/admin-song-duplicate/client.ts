import {
  createRequestTimeout,
  readErrorEnvelope,
  readJson
} from "../http/client";
import { AdminSongClientError } from "../admin-song/client";
import {
  DUPLICATE_CANDIDATE_LIMIT,
  type DuplicateCheckInput,
  type DuplicateCheckResult
} from "./types";

const DUPLICATE_CHECK_CLIENT_TIMEOUT_MS = 4_000;

export async function checkAdminSongDuplicate(
  input: DuplicateCheckInput,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<DuplicateCheckResult> {
  const timeout = createRequestTimeout(
    DUPLICATE_CHECK_CLIENT_TIMEOUT_MS,
    signal
  );
  try {
    const response = await fetcher("/api/admin/songs/duplicate-check", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-knf-request": "1"
      },
      body: JSON.stringify(input),
      signal: timeout.signal
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const envelope = readErrorEnvelope(payload);
      throw new AdminSongClientError(
        envelope.code ?? "DUPLICATE_CHECK_UNAVAILABLE",
        response.status,
        payload,
        response.headers.get("retry-after")
      );
    }
    if (!isDuplicateCheckResult(payload)) {
      throw new AdminSongClientError("INVALID_RESPONSE", response.status);
    }
    return payload;
  } finally {
    timeout.clear();
  }
}

function isDuplicateCheckResult(value: unknown): value is DuplicateCheckResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("classification" in value) ||
    !["exact", "possible", "none"].includes(String(value.classification)) ||
    !("candidates" in value) ||
    !Array.isArray(value.candidates)
  ) {
    return false;
  }
  return (
    value.candidates.length <= DUPLICATE_CANDIDATE_LIMIT &&
    value.candidates.every(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        "id" in candidate &&
        typeof candidate.id === "string" &&
        "display_title" in candidate &&
        typeof candidate.display_title === "string" &&
        "canonical_artist" in candidate &&
        typeof candidate.canonical_artist === "string" &&
        "match_evidence" in candidate &&
        Array.isArray(candidate.match_evidence)
    )
  );
}
