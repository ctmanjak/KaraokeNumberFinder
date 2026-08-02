import { describe, expect, it, vi } from "vitest";

import {
  PERSONALIZATION_ERROR_CODES,
  createPersonalizationErrorResponse,
  createPersonalizationRequestId,
  personalizationDomainError,
  personalizationError
} from "./errors";

const STATUS_BY_CODE = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  PERSONALIZATION_UNAVAILABLE: 500
} as const;

describe("personalization error contract", () => {
  it("maps every common code to the unified envelope and status", async () => {
    for (const code of PERSONALIZATION_ERROR_CODES) {
      const writeSafeLog = vi.fn();
      const requestId = `request-${code.toLowerCase()}`;
      const response = createPersonalizationErrorResponse(
        personalizationError(code),
        { requestId, writeSafeLog }
      );
      const body = (await response.json()) as {
        error: { code: string; message: string; request_id: string };
      };

      expect(response.status).toBe(STATUS_BY_CODE[code]);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toBeTypeOf("string");
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(body.error.request_id).toBe(requestId);
      expect(response.headers.get("x-request-id")).toBe(requestId);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(writeSafeLog).toHaveBeenCalledWith({
        event: "personalization_api_failure",
        code,
        request_id: requestId,
        status: STATUS_BY_CODE[code]
      });
    }
  });

  it("adds the Session authentication challenge only to 401", () => {
    const unauthenticated = createPersonalizationErrorResponse(
      personalizationError("UNAUTHENTICATED"),
      { requestId: "unauthenticated", writeSafeLog: () => undefined }
    );
    const forbidden = createPersonalizationErrorResponse(
      personalizationError("FORBIDDEN"),
      { requestId: "forbidden", writeSafeLog: () => undefined }
    );

    expect(unauthenticated.headers.get("www-authenticate")).toBe("Session");
    expect(forbidden.headers.has("www-authenticate")).toBe(false);
  });

  it("lets domain modules add safe codes without editing the shared map", async () => {
    const response = createPersonalizationErrorResponse(
      personalizationDomainError({
        code: "SONG_NOT_FOUND",
        status: 404,
        publicMessage: "Song was not found."
      }),
      { requestId: "domain-error", writeSafeLog: () => undefined }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "SONG_NOT_FOUND",
        message: "Song was not found.",
        request_id: "domain-error"
      }
    });
  });

  it("creates opaque server request IDs", () => {
    const first = createPersonalizationRequestId();
    const second = createPersonalizationRequestId();

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
    expect(second).not.toBe(first);
  });

  it("serializes only allowlisted error detail fields", async () => {
    const response = createPersonalizationErrorResponse(
      personalizationDomainError({
        code: "DUPLICATE_SONG",
        status: 409,
        publicMessage: "Duplicate.",
        details: {
          candidates: [
            {
              id: "song-a",
              display_title: "must-not-leak"
            } as { id: string }
          ]
        }
      }),
      { requestId: "safe-details", writeSafeLog: () => undefined }
    );

    expect(await response.json()).toStrictEqual({
      error: {
        code: "DUPLICATE_SONG",
        message: "Duplicate.",
        request_id: "safe-details",
        details: { candidates: [{ id: "song-a" }] }
      }
    });
  });

  it("preserves an explicit safe duplicate candidate DTO and strips extra fields", async () => {
    const candidateWithSecret = {
      id: "song-a",
      display_title: "레몬",
      canonical_title: "Lemon",
      canonical_artist: "米津玄師",
      original_language: "ja",
      release_year: 2018,
      tie_in: null,
      provider_summary: [
        {
          provider_id: "tj",
          provider_name: "TJ",
          karaoke_number: "28822",
          version_info: ""
        }
      ],
      match_evidence: [
        {
          role: "title",
          strength: "exact",
          input_field: "canonical_title",
          candidate_field: "song.canonical_title",
          matched_value: "Lemon"
        }
      ],
      admin_path: "/admin/songs/song-a",
      source_url: "must-not-leak"
    } as const;
    const response = createPersonalizationErrorResponse(
      personalizationDomainError({
        code: "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED",
        status: 409,
        publicMessage: "Confirm candidates.",
        details: {
          candidates: [candidateWithSecret]
        }
      }),
      { requestId: "candidate-details", writeSafeLog: () => undefined }
    );

    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        code: "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED",
        message: "Confirm candidates.",
        request_id: "candidate-details",
        details: {
          candidates: [
            {
              id: "song-a",
              display_title: "레몬",
              canonical_title: "Lemon",
              canonical_artist: "米津玄師",
              original_language: "ja",
              release_year: 2018,
              tie_in: null,
              provider_summary: [
                {
                  provider_id: "tj",
                  provider_name: "TJ",
                  karaoke_number: "28822",
                  version_info: ""
                }
              ],
              match_evidence: [
                {
                  role: "title",
                  strength: "exact",
                  input_field: "canonical_title",
                  candidate_field: "song.canonical_title",
                  matched_value: "Lemon"
                }
              ],
              admin_path: "/admin/songs/song-a"
            }
          ]
        }
      }
    });
    expect(JSON.stringify(payload)).not.toContain("must-not-leak");
  });

  it("redacts unexpected errors from both response and safe logs", async () => {
    const secrets = [
      "session-token-must-not-leak",
      "oauth-token-must-not-leak",
      "knf-dev.session_token=raw-cookie-must-not-leak",
      "Authorization: Bearer authorization-must-not-leak",
      "singer@example.com",
      '{"raw_body":"must-not-leak"}',
      "postgres://user:password@database/internal"
    ];
    const writeSafeLog = vi.fn();
    const response = createPersonalizationErrorResponse(
      new Error(secrets.join(" ")),
      { requestId: "safe-request", writeSafeLog }
    );
    const serialized = `${await response.text()} ${JSON.stringify(
      writeSafeLog.mock.calls
    )}`;

    expect(response.status).toBe(500);
    expect(serialized).toContain("PERSONALIZATION_UNAVAILABLE");
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
  });
});
