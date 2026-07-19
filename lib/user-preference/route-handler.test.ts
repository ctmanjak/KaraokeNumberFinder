import { describe, expect, it, vi } from "vitest";

import {
  createPersonalizationHandler,
  personalizationDomainError,
  personalizationError,
  type RequireSession
} from "../personalization";
import {
  createDefaultProviderPutHandler,
  createUserPreferenceGetHandler
} from "./route-handler";
import type { UserPreferenceService } from "./service";

const ORIGIN = "https://knf.example";
const REQUEST_ID = "user-preference-request-id";

describe("user preference route handlers", () => {
  it("reads only the authenticated user's preference", async () => {
    const service = serviceStub();
    const response = await protectedHandler(
      createUserPreferenceGetHandler(service)
    )(new Request(`${ORIGIN}/api/user-preference`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.get).toHaveBeenCalledWith({
      userId: "authenticated-user"
    });
  });

  it("rejects query input instead of accepting a user identity", async () => {
    const service = serviceStub();
    const response = await protectedHandler(
      createUserPreferenceGetHandler(service)
    )(new Request(`${ORIGIN}/api/user-preference?user_id=another-user`));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" }
    });
    expect(service.get).not.toHaveBeenCalled();
  });

  it("accepts a same-origin active provider PUT", async () => {
    const service = serviceStub();
    const response = await protectedHandler(
      createDefaultProviderPutHandler(service)
    )(mutationRequest(JSON.stringify({ provider_id: "provider-active" })));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.setDefaultProvider).toHaveBeenCalledWith({
      userId: "authenticated-user",
      providerId: "provider-active"
    });
  });

  it("accepts null as an explicit setting clear", async () => {
    const service = serviceStub();
    const response = await protectedHandler(
      createDefaultProviderPutHandler(service)
    )(mutationRequest(JSON.stringify({ provider_id: null })));

    expect(response.status).toBe(200);
    expect(service.setDefaultProvider).toHaveBeenCalledWith({
      userId: "authenticated-user",
      providerId: null
    });
  });

  it("rejects mutation query identity before the domain service", async () => {
    const service = serviceStub();
    const response = await protectedHandler(
      createDefaultProviderPutHandler(service)
    )(
      mutationRequest(
        JSON.stringify({ provider_id: "provider-active" }),
        {},
        "/api/user-preference/default-provider?user_id=another-user"
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" }
    });
    expect(service.setDefaultProvider).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{", 400, "INVALID_REQUEST"],
    ["missing provider", "{}", 422, "VALIDATION_ERROR"],
    ["empty provider", '{"provider_id":""}', 422, "VALIDATION_ERROR"],
    ["blank provider", '{"provider_id":"   "}', 422, "VALIDATION_ERROR"],
    ["wrong type", '{"provider_id":42}', 422, "VALIDATION_ERROR"],
    [
      "too long",
      JSON.stringify({ provider_id: "p".repeat(129) }),
      422,
      "VALIDATION_ERROR"
    ],
    [
      "body user ID",
      JSON.stringify({ provider_id: "provider-active", user_id: "other" }),
      422,
      "VALIDATION_ERROR"
    ]
  ])(
    "maps %s to the fixed validation contract",
    async (_name, body, status, code) => {
      const service = serviceStub();
      const response = await protectedHandler(
        createDefaultProviderPutHandler(service)
      )(mutationRequest(body));

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
      expect(service.setDefaultProvider).not.toHaveBeenCalled();
    }
  );

  it("maps inactive or missing providers to INVALID_PROVIDER", async () => {
    const service = serviceStub({
      setDefaultProvider: vi.fn(async () => {
        throw personalizationDomainError({
          code: "INVALID_PROVIDER",
          status: 422,
          publicMessage: "Provider is unavailable."
        });
      })
    });
    const response = await protectedHandler(
      createDefaultProviderPutHandler(service)
    )(mutationRequest(JSON.stringify({ provider_id: "provider-missing" })));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_PROVIDER",
        message: "Provider is unavailable.",
        request_id: REQUEST_ID
      }
    });
  });

  it.each([
    ["Origin", { origin: "https://evil.example" }],
    ["Sec-Fetch-Site", { "sec-fetch-site": "cross-site" }],
    ["Content-Type", { "content-type": "text/plain" }],
    ["X-KNF-Request", { "x-knf-request": "0" }]
  ])(
    "rejects invalid %s before session, body, domain, or DB",
    async (_name, overrides) => {
      const service = serviceStub();
      const requireSession = vi.fn(async () => ({
        user: { id: "authenticated-user" }
      }));
      const response = await protectedHandler(
        createDefaultProviderPutHandler(service),
        requireSession
      )(
        mutationRequest(
          JSON.stringify({
            provider_id: "provider-active",
            sensitive_body: "must-not-be-read"
          }),
          overrides
        )
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        error: { code: "CSRF_REJECTED" }
      });
      expect(requireSession).not.toHaveBeenCalled();
      expect(service.setDefaultProvider).not.toHaveBeenCalled();
    }
  );

  it.each(["missing", "forged", "expired", "revoked"])(
    "returns 401 and WWW-Authenticate for a %s session",
    async () => {
      const service = serviceStub();
      const response = await protectedHandler(
        createUserPreferenceGetHandler(service),
        async () => {
          throw personalizationError("UNAUTHENTICATED");
        }
      )(new Request(`${ORIGIN}/api/user-preference`));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Session");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(service.get).not.toHaveBeenCalled();
    }
  );

  it("maps repository failures to a safe response and safe log", async () => {
    const secrets = [
      "provider-secret",
      "session-cookie-secret",
      "oauth-token-secret",
      "singer@example.com",
      "SQLSTATE 23503 constraint detail"
    ];
    const events: unknown[] = [];
    const service = serviceStub({
      setDefaultProvider: vi.fn(async () => {
        throw new Error(secrets[4]);
      })
    });
    const handler = createPersonalizationHandler(
      createDefaultProviderPutHandler(service),
      {
        requireSession: async () => ({ user: { id: "authenticated-user" } }),
        trustedOrigin: ORIGIN,
        generateRequestId: () => REQUEST_ID,
        writeSafeLog: (event) => events.push(event)
      }
    );
    const response = await handler(
      mutationRequest(JSON.stringify({ provider_id: secrets[0] }), {
        cookie: `knf.session=${secrets[1]}`,
        authorization: `Bearer ${secrets[2]}`,
        "x-user-email": secrets[3]
      })
    );
    const responseText = await response.text();
    const logText = JSON.stringify(events);

    expect(response.status).toBe(500);
    expect(responseText).toContain("PERSONALIZATION_UNAVAILABLE");
    expect(events).toEqual([
      {
        event: "personalization_api_failure",
        code: "PERSONALIZATION_UNAVAILABLE",
        request_id: REQUEST_ID,
        status: 500
      }
    ]);
    for (const secret of secrets) {
      expect(responseText).not.toContain(secret);
      expect(logText).not.toContain(secret);
    }
  });
});

function protectedHandler(
  handler: Parameters<typeof createPersonalizationHandler>[0],
  requireSession: RequireSession = async () => ({
    user: { id: "authenticated-user" }
  })
) {
  return createPersonalizationHandler(handler, {
    requireSession,
    trustedOrigin: ORIGIN,
    generateRequestId: () => REQUEST_ID,
    writeSafeLog: () => undefined
  });
}

function mutationRequest(
  body: string,
  overrides: Record<string, string> = {},
  path = "/api/user-preference/default-provider"
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "PUT",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-knf-request": "1",
      ...overrides
    },
    body
  });
}

function serviceStub(
  overrides: Partial<UserPreferenceService> = {}
): UserPreferenceService {
  return {
    get: vi.fn(async () => ({
      default_provider: null,
      source: "none" as const
    })),
    setDefaultProvider: vi.fn(async () => ({
      default_provider: null,
      source: "none" as const
    })),
    ...overrides
  };
}
