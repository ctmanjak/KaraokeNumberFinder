import { describe, expect, it, vi } from "vitest";

import { createPersonalizationHandler } from "./handler";
import { createRequireSession } from "./session";

const REQUEST_ID = "request-session-contract";

describe("createRequireSession", () => {
  it.each([
    ["missing cookie", undefined],
    ["forged session", "knf-dev.session_token=forged.signed"],
    ["expired session", "knf-dev.session_token=expired.signed"],
    ["revoked session", "knf-dev.session_token=revoked.signed"]
  ])("maps a %s to the 401 contract", async (_name, cookie) => {
    const getSession = vi.fn(async () => null);
    const response = await protectedResponse(getSession, cookie);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Session");
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required.",
        request_id: REQUEST_ID
      }
    });
    expect(getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: {
        disableCookieCache: true,
        disableRefresh: true
      }
    });
  });

  it("returns only the authenticated user ID and removes session secrets", async () => {
    const getSession = vi.fn(async () => ({
      user: {
        id: "user-123",
        email: "singer@example.com",
        name: "Singer"
      },
      session: {
        id: "session-id",
        userId: "user-123",
        token: "session-token-must-not-leak",
        expiresAt: new Date("2026-07-20T00:00:00Z")
      },
      account: {
        accessToken: "oauth-access-token-must-not-leak"
      }
    }));
    const requireSession = createRequireSession(getSession);

    const auth = await requireSession(
      new Request("https://knf.example/api/favorites", {
        headers: { cookie: "__Host-knf.session_token=signed-secret" }
      })
    );

    expect(auth).toEqual({ user: { id: "user-123" } });
    const serialized = JSON.stringify(auth);
    expect(serialized).not.toContain("session-token-must-not-leak");
    expect(serialized).not.toContain("oauth-access-token-must-not-leak");
    expect(serialized).not.toContain("singer@example.com");
  });

  it("isolates session lookup and malformed auth results as unavailable", async () => {
    for (const getSession of [
      vi.fn(async () => {
        throw new Error("database host and password must not leak");
      }),
      vi.fn(async () => ({ session: { token: "secret" } })),
      vi.fn(async () => ({ user: { id: "user-123" } })),
      vi.fn(async () => ({
        session: { userId: "different-user" },
        user: { id: "user-123" }
      }))
    ]) {
      const response = await protectedResponse(getSession);
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toContain("PERSONALIZATION_UNAVAILABLE");
      expect(body).not.toContain("database host");
      expect(body).not.toContain("password");
      expect(body).not.toContain("secret");
    }
  });
});

async function protectedResponse(
  getSession: Parameters<typeof createRequireSession>[0],
  cookie?: string
): Promise<Response> {
  const handler = createPersonalizationHandler(
    async ({ auth }) => Response.json(auth),
    {
      requireSession: createRequireSession(getSession),
      trustedOrigin: "https://knf.example",
      generateRequestId: () => REQUEST_ID,
      writeSafeLog: () => undefined
    }
  );
  const headers = new Headers();
  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }

  return handler(
    new Request("https://knf.example/api/favorites", {
      headers
    })
  );
}
