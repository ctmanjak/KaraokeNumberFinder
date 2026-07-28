import { describe, expect, it, vi } from "vitest";

import {
  createAdminCatalogHandler,
  type AdminCatalogActorRole
} from "../admin-catalog/guard";
import {
  personalizationDomainError,
  personalizationError
} from "../personalization";
import { createAdminSongDuplicateCheckHandler } from "./route-handler";
import type { AdminSongDuplicateService } from "./service";

const ORIGIN = "https://knf.example";

describe("administrator duplicate-check route", () => {
  it("applies the guard matrix before candidate work", async () => {
    for (const [actor, status, code] of [
      ["guest", 401, "UNAUTHENTICATED"],
      ["user", 403, "FORBIDDEN"],
      ["admin-off", 403, "ADMIN_CATALOG_NOT_ENABLED"],
      ["admin-on", 200, undefined]
    ] as const) {
      const service = stubService();
      const response = await protectedHandler(service, actor)(validRequest());

      expect(response.status).toBe(status);
      expect(service.check).toHaveBeenCalledTimes(actor === "admin-on" ? 1 : 0);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-request-id")).toBe("duplicate-request-id");
      if (code !== undefined) {
        expect((await response.json()).error.code).toBe(code);
      }
    }
  });

  it.each([
    ["csrf", invalidOriginRequest(), 403, "CSRF_REJECTED"],
    ["media type", validRequest("text/plain"), 415, "UNSUPPORTED_MEDIA_TYPE"],
    [
      "validation",
      validRequest("application/json", { normalized_title: "x" }),
      422,
      "VALIDATION_ERROR"
    ],
    ["actual byte limit", oversizedRequest(), 413, "PAYLOAD_TOO_LARGE"]
  ])(
    "returns the standard %s error before candidate work",
    async (_name, request, status, code) => {
      const service = stubService();
      const response = await protectedHandler(service, "admin-on")(request);

      expect(response.status).toBe(status);
      expect((await response.json()).error).toMatchObject({
        code,
        request_id: "duplicate-request-id"
      });
      expect(service.check).not.toHaveBeenCalled();
    }
  );

  it("does not let a non-JSON request bypass CSRF ordering", async () => {
    const service = stubService();
    const response = await protectedHandler(
      service,
      "admin-on"
    )(invalidOriginRequest("text/plain"));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CSRF_REJECTED");
    expect(service.check).not.toHaveBeenCalled();
  });

  it("maps duplicate statement timeout to an explicit 503 rather than no candidates", async () => {
    const service = stubService();
    service.check.mockRejectedValueOnce(
      personalizationDomainError({
        code: "DUPLICATE_CHECK_UNAVAILABLE",
        status: 503,
        publicMessage: "Duplicate checking is temporarily unavailable."
      })
    );

    const response = await protectedHandler(
      service,
      "admin-on"
    )(validRequest());

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatchObject({
      code: "DUPLICATE_CHECK_UNAVAILABLE",
      request_id: "duplicate-request-id"
    });
  });
});

function protectedHandler(
  service: ReturnType<typeof stubService>,
  actor: "guest" | "user" | "admin-off" | "admin-on"
) {
  return createAdminCatalogHandler(
    "song_duplicate_check_api",
    createAdminSongDuplicateCheckHandler(service as AdminSongDuplicateService),
    {
      requireSession: async () => {
        if (actor === "guest") throw personalizationError("UNAUTHENTICATED");
        return { user: { id: `${actor}-id` } };
      },
      readActorRole: async (): Promise<AdminCatalogActorRole> =>
        actor === "user" ? "user" : "admin",
      isCatalogEnabled: () => actor === "admin-on",
      trustedOrigin: ORIGIN,
      requireJsonInCsrf: false,
      generateRequestId: () => "duplicate-request-id",
      writeFeatureDeniedEvent: () => undefined,
      writeSafeLog: () => undefined
    }
  );
}

function stubService() {
  return {
    check: vi.fn(async () => ({
      classification: "none" as const,
      candidates: []
    }))
  };
}

function validRequest(
  contentType = "application/json",
  body: unknown = {
    canonical_title: "Lemon",
    display_title: "레몬",
    canonical_artist: "米津玄師",
    exclude_song_id: "song-a"
  }
) {
  return new Request(`${ORIGIN}/api/admin/songs/duplicate-check`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-knf-request": "1",
      "content-type": contentType
    },
    body: JSON.stringify(body)
  });
}

function invalidOriginRequest(contentType = "application/json") {
  return new Request(`${ORIGIN}/api/admin/songs/duplicate-check`, {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
      "x-knf-request": "1",
      "content-type": contentType
    },
    body: "{}"
  });
}

function oversizedRequest() {
  return validRequest("application/json", {
    canonical_title: "x".repeat(70_000),
    canonical_artist: "artist"
  });
}
