import { describe, expect, it, vi } from "vitest";

import type { OAuthFlowStore } from "./oauth-flow-store";
import { authCookiePolicy } from "./policy";
import {
  createAuthRouteHandlers,
  type AuthFrameworkHandlers,
  type AuthRouteDependencies
} from "./route-handler";

const BASE_ORIGIN = "https://example.com";
const CALLBACK_URL = `${BASE_ORIGIN}/api/auth/callback/google`;
const CLIENT_ID = "google-client-id";
const STATE = "state-that-is-at-least-thirty-two-characters";
const CHALLENGE = "challenge-that-is-at-least-forty-three-characters-long";

describe("createAuthRouteHandlers", () => {
  it("adds nonce while preserving state and S256 PKCE for Google-only sign-in", async () => {
    const flowStore = createMemoryFlowStore();
    let forwardedBody: Record<string, unknown> | null = null;
    const framework = frameworkHandlers({
      async POST(request) {
        forwardedBody = (await request.json()) as Record<string, unknown>;
        const url = googleAuthorizationURL();
        return new Response(
          JSON.stringify({ url: url.toString(), redirect: false }),
          {
            headers: {
              "content-type": "application/json",
              "set-cookie":
                "__Host-knf.state=signed-state; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure"
            }
          }
        );
      }
    });
    const handlers = createHandlers({
      framework,
      flowStore,
      generateNonce: () => "nonce-that-is-at-least-thirty-two-characters"
    });

    const response = await handlers.POST(
      jsonRequest("/api/auth/sign-in/social", {
        provider: "google",
        callbackURL: "/favorites"
      })
    );
    const body = (await response.json()) as {
      redirect: boolean;
      url: string;
    };
    const authorizationURL = new URL(body.url);

    expect(response.status).toBe(200);
    expect(body.redirect).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe(body.url);
    expect(authorizationURL.searchParams.get("state")).toBe(STATE);
    expect(authorizationURL.searchParams.get("nonce")).toBe(
      "nonce-that-is-at-least-thirty-two-characters"
    );
    expect(authorizationURL.searchParams.get("code_challenge_method")).toBe(
      "S256"
    );
    expect(
      new Set(authorizationURL.searchParams.get("scope")?.split(" "))
    ).toEqual(new Set(["openid", "email", "profile"]));
    expect(authorizationURL.searchParams.has("access_type")).toBe(false);
    expect(forwardedBody).toMatchObject({
      provider: "google",
      callbackURL: "/favorites",
      errorCallbackURL: "/",
      additionalData: {
        knfNonce: "nonce-that-is-at-least-thirty-two-characters"
      }
    });
    expect(flowStore.registered.has(STATE)).toBe(true);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/%2f%2fevil.example",
    "/favorites?next=evil"
  ])(
    "rejects open redirect input %s before Better Auth",
    async (callbackURL) => {
      const POST = vi.fn();
      const handlers = createHandlers({
        framework: frameworkHandlers({ POST }),
        flowStore: createMemoryFlowStore()
      });

      const response = await handlers.POST(
        jsonRequest("/api/auth/sign-in/social", {
          provider: "google",
          callbackURL
        })
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_CALLBACK_URL" }
      });
      expect(POST).not.toHaveBeenCalled();
    }
  );

  it("rejects ID-token, extra-scope, and non-Google sign-in variants", async () => {
    const handlers = createHandlers({
      framework: frameworkHandlers(),
      flowStore: createMemoryFlowStore()
    });

    for (const body of [
      { provider: "github", callbackURL: "/" },
      { provider: "google", callbackURL: "/", scopes: ["drive"] },
      { provider: "google", callbackURL: "/", idToken: { token: "secret" } },
      { provider: "google", callbackURL: "/", disableRedirect: true }
    ]) {
      const response = await handlers.POST(
        jsonRequest("/api/auth/sign-in/social", body)
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("secret");
    }
  });

  it("issues a safe redirect, rotates a previous session, and rejects replay", async () => {
    const flowStore = createMemoryFlowStore([STATE]);
    const events: string[] = [];
    const revokeSessionToken = vi.fn(async () => {
      events.push("revoke");
    });
    const cookie = authCookiePolicy(true);
    const framework = frameworkHandlers({
      async GET() {
        events.push("callback");
        return new Response(null, {
          status: 302,
          headers: {
            location: "/favorites",
            "set-cookie": `${cookie.sessionCookieName}=new-session-secret.signed; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure`
          }
        });
      }
    });
    const handlers = createHandlers({
      framework,
      flowStore,
      readExistingSessionToken: async () => "previous-session-secret",
      revokeSessionToken
    });
    const callback = new Request(
      `${CALLBACK_URL}?code=authorization-code&state=${STATE}`
    );

    const success = await handlers.GET(callback);
    const replay = await handlers.GET(callback);

    expect(success.status).toBe(302);
    expect(success.headers.get("location")).toBe("/favorites");
    expect(revokeSessionToken).toHaveBeenCalledWith("previous-session-secret");
    expect(events).toEqual(["revoke", "callback"]);
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toBe("/?auth_error=OAUTH_FAILED");
  });

  it.each(["lookup", "revoke"] as const)(
    "fails closed before callback when previous-session %s fails",
    async (failure) => {
      const GET = vi.fn();
      const handlers = createHandlers({
        flowStore: createMemoryFlowStore([STATE]),
        framework: frameworkHandlers({ GET }),
        readExistingSessionToken: async () => {
          if (failure === "lookup") {
            throw new Error("session lookup failed");
          }
          return "previous-session-secret";
        },
        revokeSessionToken: async () => {
          throw new Error("session revoke failed");
        }
      });

      const response = await handlers.GET(
        new Request(`${CALLBACK_URL}?code=authorization-code&state=${STATE}`)
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/?auth_error=OAUTH_FAILED"
      );
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(GET).not.toHaveBeenCalled();
    }
  );

  it("maps cancellation and email identity conflicts to safe home errors", async () => {
    for (const [providerError, expected] of [
      ["access_denied", "OAUTH_FAILED"],
      ["account_not_linked", "ACCOUNT_CONFLICT"]
    ] as const) {
      const flowStore = createMemoryFlowStore([STATE]);
      const handlers = createHandlers({
        flowStore,
        framework: frameworkHandlers({
          async GET() {
            return new Response(null, {
              status: 302,
              headers: { location: `/?error=${providerError}` }
            });
          }
        })
      });

      const response = await handlers.GET(
        new Request(`${CALLBACK_URL}?state=${STATE}&error=${providerError}`)
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/?auth_error=${expected}`);
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    }
  });

  it("strips session tokens from JSON and caps refreshed cookie expiry", async () => {
    const cookie = authCookiePolicy(true);
    const now = new Date("2026-01-30T00:00:00.000Z");
    const expiresAt = new Date("2026-01-31T00:00:00.000Z");
    const handlers = createHandlers({
      now: () => now,
      flowStore: createMemoryFlowStore(),
      framework: frameworkHandlers({
        async GET() {
          return new Response(
            JSON.stringify({
              session: {
                id: "session-id",
                token: "session-token-secret",
                expiresAt: expiresAt.toISOString()
              },
              user: { id: "user-id" }
            }),
            {
              headers: {
                "content-type": "application/json",
                "set-cookie": `${cookie.sessionCookieName}=session-token-secret.signed; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure`
              }
            }
          );
        }
      })
    });

    const response = await handlers.GET(
      new Request(`${BASE_ORIGIN}/api/auth/get-session`)
    );
    const text = await response.text();

    expect(text).not.toContain("session-token-secret");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=86400");
    expect(response.headers.get("set-cookie")).toContain(
      `Expires=${expiresAt.toUTCString()}`
    );
  });

  it("clears the browser cookie even if logout storage deletion throws", async () => {
    const logs: string[] = [];
    const cookie = authCookiePolicy(true);
    const handlers = createHandlers({
      flowStore: createMemoryFlowStore(),
      framework: frameworkHandlers({
        async POST() {
          throw new Error("database detail with session-token-secret");
        }
      }),
      writeSafeLog(event) {
        logs.push(event);
      }
    });

    const response = await handlers.POST(
      new Request(`${BASE_ORIGIN}/api/auth/sign-out`, { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe(
      `${cookie.sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`
    );
    expect(await response.json()).toEqual({ success: true });
    expect(JSON.stringify(logs)).not.toContain("session-token-secret");
  });
});

function createHandlers(
  overrides: Partial<AuthRouteDependencies> &
    Pick<AuthRouteDependencies, "framework" | "flowStore">
) {
  return createAuthRouteHandlers({
    baseOrigin: BASE_ORIGIN,
    googleClientId: CLIENT_ID,
    googleCallbackURL: CALLBACK_URL,
    cookie: authCookiePolicy(true),
    ...overrides
  });
}

function frameworkHandlers(
  overrides: Partial<AuthFrameworkHandlers> = {}
): AuthFrameworkHandlers {
  return {
    async GET() {
      return new Response(null, { status: 404 });
    },
    async POST() {
      return new Response(null, { status: 404 });
    },
    ...overrides
  };
}

function googleAuthorizationURL(): URL {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", CALLBACK_URL);
  url.searchParams.set("scope", "email profile openid");
  url.searchParams.set("state", STATE);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", CHALLENGE);
  return url;
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`${BASE_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE_ORIGIN,
      "sec-fetch-site": "same-origin"
    },
    body: JSON.stringify(body)
  });
}

function createMemoryFlowStore(initialStates: string[] = []): OAuthFlowStore & {
  registered: Set<string>;
} {
  const registered = new Set(initialStates);
  return {
    registered,
    async register(state) {
      registered.add(state);
    },
    async consume(state) {
      return registered.delete(state);
    },
    async abort(state) {
      registered.delete(state);
    }
  };
}
