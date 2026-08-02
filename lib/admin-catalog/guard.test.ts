import { describe, expect, it, vi } from "vitest";

import { personalizationError } from "../personalization";
import {
  createAdminCatalogHandler,
  resolveAdminCatalogPageAccess,
  type AdminCatalogActorRole
} from "./guard";

const ORIGIN = "https://knf.example";
const REQUEST_ID = "catalog-request-id";

describe("admin catalog guard", () => {
  it.each([
    ["guest", 401, "UNAUTHENTICATED", 0],
    ["user", 403, "FORBIDDEN", 1],
    ["admin-off", 403, "ADMIN_CATALOG_NOT_ENABLED", 1],
    ["admin-on", 200, undefined, 1]
  ] as const)(
    "enforces the guest/user/admin ordering for %s",
    async (actor, status, code, roleReads) => {
      const handler = vi.fn(async () => Response.json({ ok: true }));
      const readActorRole = vi.fn(async (): Promise<AdminCatalogActorRole> => {
        if (actor === "user") return "user";
        return "admin";
      });
      const isCatalogEnabled = vi.fn(() => actor === "admin-on");
      const featureEvents: unknown[] = [];
      const protectedHandler = createAdminCatalogHandler(
        "songs_list_api",
        handler,
        {
          requireSession: async () => {
            if (actor === "guest") {
              throw personalizationError("UNAUTHENTICATED");
            }
            return { user: { id: `${actor}-id` } };
          },
          readActorRole,
          isCatalogEnabled,
          trustedOrigin: ORIGIN,
          generateRequestId: () => REQUEST_ID,
          writeFeatureDeniedEvent: (event) => featureEvents.push(event),
          writeSafeLog: () => undefined,
          now: () => new Date("2026-07-26T00:00:00.000Z")
        }
      );

      const response = await protectedHandler(
        new Request(`${ORIGIN}/api/admin/songs`)
      );

      expect(response.status).toBe(status);
      expect(readActorRole).toHaveBeenCalledTimes(roleReads);
      expect(isCatalogEnabled).toHaveBeenCalledTimes(
        actor === "admin-off" || actor === "admin-on" ? 1 : 0
      );
      expect(handler).toHaveBeenCalledTimes(actor === "admin-on" ? 1 : 0);
      expect(response.headers.get("cache-control")).toContain("no-store");
      if (code !== undefined) {
        expect(await response.json()).toEqual({
          error: {
            code,
            message: expect.any(String),
            request_id: REQUEST_ID
          }
        });
      }
      expect(featureEvents).toHaveLength(actor === "admin-off" ? 1 : 0);
    }
  );

  it("checks an enabled admin before applying mutation CSRF validation", async () => {
    const order: string[] = [];
    const handler = vi.fn();
    const protectedHandler = createAdminCatalogHandler(
      "song_create_api",
      handler,
      {
        requireSession: async () => {
          order.push("session");
          return { user: { id: "admin-a" } };
        },
        readActorRole: async () => {
          order.push("role");
          return "admin";
        },
        isCatalogEnabled: () => {
          order.push("feature");
          return true;
        },
        trustedOrigin: ORIGIN,
        generateRequestId: () => REQUEST_ID,
        writeSafeLog: () => undefined
      }
    );

    const response = await protectedHandler(
      new Request(`${ORIGIN}/api/admin/songs`, { method: "POST" })
    );

    expect(order).toEqual(["session", "role", "feature"]);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CSRF_REJECTED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects an off-mode administrator before mutation CSRF or catalog work", async () => {
    const handler = vi.fn();
    const writeFeatureDeniedEvent = vi.fn();
    const protectedHandler = createAdminCatalogHandler(
      "song_create_api",
      handler,
      {
        requireSession: async () => ({ user: { id: "admin-a" } }),
        readActorRole: async () => "admin",
        isCatalogEnabled: () => false,
        trustedOrigin: ORIGIN,
        generateRequestId: () => REQUEST_ID,
        writeFeatureDeniedEvent,
        writeSafeLog: () => undefined
      }
    );

    const response = await protectedHandler(
      new Request(`${ORIGIN}/api/admin/songs`, { method: "POST" })
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe(
      "ADMIN_CATALOG_NOT_ENABLED"
    );
    expect(handler).not.toHaveBeenCalled();
    expect(writeFeatureDeniedEvent).not.toHaveBeenCalled();
  });

  it("correlates the response envelope, header, and completion with one server request ID", async () => {
    const onComplete = vi.fn();
    const protectedHandler = createAdminCatalogHandler(
      "song_create_api",
      async () => {
        throw personalizationError("FORBIDDEN");
      },
      {
        requireSession: async () => ({ user: { id: "admin-a" } }),
        readActorRole: async () => "admin",
        isCatalogEnabled: () => true,
        trustedOrigin: ORIGIN,
        requireJsonInCsrf: false,
        generateRequestId: () => REQUEST_ID,
        onComplete,
        writeSafeLog: () => undefined
      }
    );

    const response = await protectedHandler(
      new Request(`${ORIGIN}/api/admin/songs`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "x-knf-request": "1",
          "content-type": "application/json"
        },
        body: "{}"
      })
    );
    const body = await response.json();

    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
    expect(body.error.request_id).toBe(REQUEST_ID);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      requestId: REQUEST_ID,
      actorUserId: "admin-a"
    });
  });

  it.each(["catalog_menu_api", "songs_list_api", "songs_options_api"] as const)(
    "stops %s before the catalog handler and emits a safe GET denial",
    async (routeCategory) => {
      const handler = vi.fn();
      const writeFeatureDeniedEvent = vi.fn();
      const protectedHandler = createAdminCatalogHandler(
        routeCategory,
        handler,
        {
          requireSession: async () => ({ user: { id: "admin-a" } }),
          readActorRole: async () => "admin",
          isCatalogEnabled: () => false,
          trustedOrigin: ORIGIN,
          generateRequestId: () => REQUEST_ID,
          writeFeatureDeniedEvent,
          writeSafeLog: () => undefined
        }
      );

      const response = await protectedHandler(
        new Request(`${ORIGIN}/api/admin/songs`)
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect((await response.json()).error).toMatchObject({
        code: "ADMIN_CATALOG_NOT_ENABLED",
        request_id: REQUEST_ID
      });
      expect(handler).not.toHaveBeenCalled();
      expect(writeFeatureDeniedEvent).toHaveBeenCalledOnce();
    }
  );

  it("emits only the redacted feature-denied fields for page and GET denial", async () => {
    const writeFeatureDeniedEvent = vi.fn();
    const access = await resolveAdminCatalogPageAccess(
      new Request(`${ORIGIN}/admin/songs?query=secret-song`, {
        headers: {
          cookie: "session=secret-token",
          "x-csrf-token": "secret-csrf"
        }
      }),
      "songs_list_page",
      {
        requireSession: async () => ({ user: { id: "internal-user-id" } }),
        readActorRole: async () => "admin",
        isCatalogEnabled: () => false,
        writeFeatureDeniedEvent,
        now: () => new Date("2026-07-26T01:02:03.000Z")
      },
      () => REQUEST_ID
    );

    expect(access).toEqual({ status: "feature_off", requestId: REQUEST_ID });
    expect(writeFeatureDeniedEvent).toHaveBeenCalledWith({
      event: "admin_catalog.feature_denied",
      occurred_at: "2026-07-26T01:02:03.000Z",
      request_id: REQUEST_ID,
      route_category: "songs_list_page",
      actor_user_id: "internal-user-id"
    });
    const serialized = JSON.stringify(writeFeatureDeniedEvent.mock.calls);
    for (const forbidden of [
      "secret-song",
      "secret-token",
      "secret-csrf",
      "email",
      "ADMIN_CATALOG_MODE",
      "cookie",
      "query"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("redacts the actor identifier from the default console event", async () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await resolveAdminCatalogPageAccess(
      new Request(`${ORIGIN}/admin/songs`),
      "songs_list_page",
      {
        requireSession: async () => ({ user: { id: "sensitive-actor-id" } }),
        readActorRole: async () => "admin",
        isCatalogEnabled: () => false
      },
      () => REQUEST_ID
    );

    expect(consoleWarn).toHaveBeenCalledWith(
      "[admin-catalog] Catalog feature access denied.",
      expect.objectContaining({
        request_id: REQUEST_ID,
        actor_user_id: "[redacted]"
      })
    );
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain(
      "sensitive-actor-id"
    );
    consoleWarn.mockRestore();
  });
});
