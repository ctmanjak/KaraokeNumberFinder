import { createHash } from "node:crypto";

import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthEnvironment } from "./env";
import type { OAuthFlowStore } from "./oauth-flow-store";
import { authCookiePolicy, SESSION_IDLE_TTL_SECONDS } from "./policy";
import { createAuthRuntime, type AuthRuntime } from "./runtime";
import {
  createPersonalizationHandler,
  createRequireSession
} from "../personalization";

const ACCESS_TOKEN = "oauth-access-token-must-not-leak";
const ID_TOKEN = "oauth-id-token-must-not-leak";
const CLIENT_ID = "google-client-id";
const LOCAL_ORIGIN = "http://localhost:3000";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Better Auth Google OAuth integration", () => {
  it("creates verified Google User/Account and a fresh database Session", async () => {
    const harness = createHarness();
    const login = await harness.startLogin("/favorites");

    expect(login.authorizationURL.searchParams.get("response_type")).toBe(
      "code"
    );
    expect(login.authorizationURL.searchParams.get("nonce")).toHaveLength(43);
    expect(
      login.authorizationURL.searchParams.get("code_challenge_method")
    ).toBe("S256");
    expect(login.stateCookie).toContain("Max-Age=600");
    expect(login.stateCookie).not.toContain("Secure");

    const callback = await harness.callback(login, "valid-code");

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/favorites");
    expect(harness.db.user).toHaveLength(1);
    expect(harness.db.account).toHaveLength(1);
    expect(harness.db.session).toHaveLength(1);
    expect(harness.db.verification).toHaveLength(0);
    expect(harness.db.user[0]).toMatchObject({
      email: "singer@example.com",
      emailVerified: true
    });
    expect(harness.db.account[0]).toMatchObject({
      providerId: "google",
      accountId: "google-subject",
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null
    });

    const session = harness.db.session[0];
    expect(session.token).toBeTypeOf("string");
    const sessionLifetimeMs =
      session.expiresAt.getTime() - session.createdAt.getTime();
    const configuredLifetimeMs = SESSION_IDLE_TTL_SECONDS * 1_000;
    expect(sessionLifetimeMs).toBeGreaterThanOrEqual(
      configuredLifetimeMs - 1_000
    );
    expect(sessionLifetimeMs).toBeLessThanOrEqual(configuredLifetimeMs);

    const sessionCookie = cookieFromResponse(
      callback,
      authCookiePolicy(false).sessionCookieName
    );
    const sessionResponse = await harness.getSession(sessionCookie);
    const sessionText = await sessionResponse.text();
    expect(JSON.parse(sessionText)).toEqual({
      user: expect.objectContaining({ id: harness.db.user[0].id })
    });
    expect(sessionText).not.toContain('"session"');
    expect(sessionText).not.toContain(session.token);
    expect(sessionText).not.toContain(ACCESS_TOKEN);
    expect(sessionText).not.toContain(ID_TOKEN);
    expect(JSON.stringify(harness.safeLogs)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(harness.safeLogs)).not.toContain(ID_TOKEN);
  });

  it("rejects cancellation, unverified email, nonce mismatch, PKCE failure, and state mismatch without a new Session", async () => {
    const cases = [
      {
        name: "cancellation",
        prepare: (harness: Harness) => {
          harness.callbackError = "access_denied";
        },
        code: "cancelled"
      },
      {
        name: "unverified email",
        prepare: (harness: Harness) => {
          harness.profile.email_verified = false;
        },
        code: "unverified"
      },
      {
        name: "nonce mismatch",
        prepare: (harness: Harness) => {
          harness.profile.nonce =
            "wrong-nonce-that-is-at-least-thirty-two-characters";
        },
        code: "nonce-mismatch"
      },
      {
        name: "issuer mismatch",
        prepare: (harness: Harness) => {
          harness.profile.iss = "https://evil.example";
        },
        code: "issuer-mismatch"
      },
      {
        name: "audience mismatch",
        prepare: (harness: Harness) => {
          harness.profile.aud = "different-client-id";
        },
        code: "audience-mismatch"
      },
      {
        name: "PKCE mismatch",
        prepare: (harness: Harness) => {
          harness.rejectTokenExchange = true;
        },
        code: "pkce-mismatch"
      },
      {
        name: "state mismatch",
        prepare: (harness: Harness) => {
          harness.mutateCallbackState = true;
        },
        code: "state-mismatch"
      }
    ];

    for (const testCase of cases) {
      const harness = createHarness();
      const login = await harness.startLogin("/");
      testCase.prepare(harness);

      const response = await harness.callback(login, testCase.code);

      expect(response.status, testCase.name).toBe(303);
      expect(response.headers.get("location"), testCase.name).toBe(
        "/?auth_error=OAUTH_FAILED"
      );
      expect(harness.db.user, testCase.name).toHaveLength(0);
      expect(harness.db.account, testCase.name).toHaveLength(0);
      expect(harness.db.session, testCase.name).toHaveLength(0);
    }
  });

  it("does not merge a different Google sub into an existing email", async () => {
    const harness = createHarness();
    const firstLogin = await harness.startLogin("/");
    await harness.callback(firstLogin, "first-code");
    expect(harness.db.session).toHaveLength(1);

    harness.profile.sub = "different-google-subject";
    const conflictingLogin = await harness.startLogin("/settings");
    const response = await harness.callback(conflictingLogin, "conflict-code");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/?auth_error=ACCOUNT_CONFLICT"
    );
    expect(harness.db.user).toHaveLength(1);
    expect(harness.db.account).toHaveLength(1);
    expect(harness.db.account[0].accountId).toBe("google-subject");
    expect(harness.db.session).toHaveLength(1);
  });

  it("rejects callback reuse and rotates an existing session identifier", async () => {
    const harness = createHarness();
    const firstLogin = await harness.startLogin("/");
    const firstCallback = await harness.callback(firstLogin, "first-code");
    const oldToken = harness.db.session[0].token as string;
    const oldCookie = cookieFromResponse(
      firstCallback,
      authCookiePolicy(false).sessionCookieName
    );

    const secondLogin = await harness.startLogin("/");
    const secondCallback = await harness.callback(
      secondLogin,
      "second-code",
      oldCookie
    );

    expect(secondCallback.status).toBe(302);
    expect(harness.db.session).toHaveLength(1);
    expect(harness.db.session[0].token).not.toBe(oldToken);

    const replay = await harness.callback(
      secondLogin,
      "second-code",
      oldCookie
    );
    expect(replay.status).toBe(303);
    expect(harness.db.session).toHaveLength(1);
  });

  it("fails closed without issuing a new Session when previous-session revocation fails", async () => {
    const harness = createHarness();
    const firstLogin = await harness.startLogin("/");
    const firstCallback = await harness.callback(firstLogin, "first-code");
    const oldToken = harness.db.session[0].token as string;
    const oldCookie = cookieFromResponse(
      firstCallback,
      authCookiePolicy(false).sessionCookieName
    );
    const secondLogin = await harness.startLogin("/");
    harness.rejectSessionRevoke = true;

    const response = await harness.callback(
      secondLogin,
      "second-code",
      oldCookie
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/?auth_error=OAUTH_FAILED");
    expect(harness.db.session).toHaveLength(1);
    expect(harness.db.session[0].token).toBe(oldToken);
    expect(harness.db.verification).toHaveLength(0);
  });

  it("caps sliding refresh at 30 days and aligns the cookie lifetime", async () => {
    const initialTime = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(initialTime);
    const harness = createHarness(() => new Date());
    const login = await harness.startLogin("/");
    const callback = await harness.callback(login, "valid-code");
    const cookie = cookieFromResponse(
      callback,
      authCookiePolicy(false).sessionCookieName
    );
    const session = harness.db.session[0];

    session.expiresAt = new Date("2026-01-31T00:00:00.000Z");
    session.updatedAt = new Date("2026-01-24T00:00:00.000Z");
    vi.setSystemTime(new Date("2026-01-30T00:00:00.000Z"));

    const response = await harness.getSession(cookie);

    expect(response.status).toBe(200);
    expect(harness.db.session[0].expiresAt).toEqual(
      new Date("2026-01-31T00:00:00.000Z")
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=86400");
  });

  it("refreshes after 24 hours without writing on every request", async () => {
    const initialTime = new Date("2026-02-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(initialTime);
    const harness = createHarness(() => new Date());
    const login = await harness.startLogin("/");
    const callback = await harness.callback(login, "valid-code");
    const cookie = cookieFromResponse(
      callback,
      authCookiePolicy(false).sessionCookieName
    );
    const initialExpiry = harness.db.session[0].expiresAt.getTime();

    vi.setSystemTime(new Date(initialTime.getTime() + 23 * 60 * 60 * 1_000));
    await harness.getSession(cookie);
    expect(harness.db.session[0].expiresAt.getTime()).toBe(initialExpiry);

    vi.setSystemTime(new Date(initialTime.getTime() + 25 * 60 * 60 * 1_000));
    await harness.getSession(cookie);
    expect(harness.db.session[0].expiresAt.getTime()).toBeGreaterThan(
      initialExpiry
    );
  });

  it("rejects and removes an expired database Session", async () => {
    const harness = createHarness();
    const login = await harness.startLogin("/");
    const callback = await harness.callback(login, "valid-code");
    const cookie = cookieFromResponse(
      callback,
      authCookiePolicy(false).sessionCookieName
    );
    harness.db.session[0].expiresAt = new Date(Date.now() - 1_000);

    const response = await harness.getSession(cookie);

    expect(await response.json()).toBeNull();
    expect(harness.db.session).toHaveLength(0);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");

    const protectedResponse = await createProtectedHandler(harness)(
      protectedRequest(cookie)
    );
    expect(protectedResponse.status).toBe(401);
    expect(protectedResponse.headers.get("www-authenticate")).toBe("Session");
  });

  it("keeps the Session for a fresh protected request, then rejects it with 401 after POST logout", async () => {
    const harness = createHarness();
    const login = await harness.startLogin("/");
    const callback = await harness.callback(login, "valid-code");
    const cookie = cookieFromResponse(
      callback,
      authCookiePolicy(false).sessionCookieName
    );
    const protectedHandler = createProtectedHandler(harness);

    const authenticated = await protectedHandler(protectedRequest(cookie));
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({
      user_id: harness.db.user[0].id
    });

    const logout = await harness.runtime.handlers.POST(
      new Request(`${LOCAL_ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          cookie,
          origin: LOCAL_ORIGIN,
          "sec-fetch-site": "same-origin"
        }
      })
    );

    expect(logout.status).toBe(200);
    expect(harness.db.session).toHaveLength(0);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

    const protectedAfterLogout = await protectedHandler(
      protectedRequest(cookie)
    );
    expect(protectedAfterLogout.status).toBe(401);
    expect(protectedAfterLogout.headers.get("www-authenticate")).toBe(
      "Session"
    );
    expect(protectedAfterLogout.headers.get("cache-control")).toBe(
      "private, no-store"
    );
    expect(await protectedAfterLogout.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" }
    });

    const reused = await harness.getSession(cookie);
    expect(await reused.json()).toBeNull();
  });

  it("emits exact production __Host cookie attributes", async () => {
    const harness = createHarness(undefined, true);
    const login = await harness.startLogin("/");
    expect(login.stateCookie).toMatch(/^__Host-knf\.state=/u);
    expect(login.stateCookie).toContain("Secure");
    expect(login.stateCookie).toContain("HttpOnly");
    expect(login.stateCookie).toContain("SameSite=Lax");
    expect(login.stateCookie).toContain("Path=/");
    expect(login.stateCookie.toLowerCase()).not.toContain("domain=");

    const callback = await harness.callback(login, "valid-code");
    const sessionCookie = fullCookieFromResponse(
      callback,
      authCookiePolicy(true).sessionCookieName
    );
    expect(sessionCookie).toMatch(/^__Host-knf\.session_token=/u);
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Path=/");
    expect(sessionCookie.toLowerCase()).not.toContain("domain=");
  });
});

type Harness = ReturnType<typeof createHarness>;

function createHarness(now?: () => Date, production = false) {
  const origin = production ? "https://example.com" : LOCAL_ORIGIN;
  const db: MemoryDB = {
    user: [],
    account: [],
    session: [],
    verification: []
  };
  const replayGuards = new Set<string>();
  const safeLogs: string[] = [];
  const profile: Record<string, unknown> = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-subject",
    email: "singer@example.com",
    email_verified: true,
    name: "Test Singer",
    picture: "https://images.example/avatar.png",
    iat: Math.floor((now?.() ?? new Date()).getTime() / 1_000),
    exp: Math.floor((now?.() ?? new Date()).getTime() / 1_000) + 3_600
  };
  let expectedCodeChallenge: string | null = null;

  const harness = {
    db,
    safeLogs,
    profile,
    callbackError: null as string | null,
    rejectTokenExchange: false,
    rejectSessionRevoke: false,
    mutateCallbackState: false,
    runtime: null as unknown as AuthRuntime,
    async startLogin(callbackURL: "/" | "/favorites" | "/settings") {
      this.callbackError = null;
      this.rejectTokenExchange = false;
      this.mutateCallbackState = false;
      profile.iat = Math.floor((now?.() ?? new Date()).getTime() / 1_000);
      profile.exp = Number(profile.iat) + 3_600;
      delete profile.nonce;

      const response = await this.runtime.handlers.POST(
        new Request(`${origin}/api/auth/sign-in/social`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            "sec-fetch-site": "same-origin"
          },
          body: JSON.stringify({
            provider: "google",
            callbackURL
          })
        })
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        redirect: boolean;
        url: string;
      };
      expect(body.redirect).toBe(true);
      const authorizationURL = new URL(body.url);
      expectedCodeChallenge =
        authorizationURL.searchParams.get("code_challenge");
      return {
        authorizationURL,
        stateCookie: fullCookieFromResponse(
          response,
          authCookiePolicy(production).stateCookieName
        )
      };
    },
    async callback(
      login: { authorizationURL: URL; stateCookie: string },
      code: string,
      existingSessionCookie?: string
    ) {
      const state = login.authorizationURL.searchParams.get("state");
      const callbackState = this.mutateCallbackState
        ? `${state}-tampered`
        : state;
      const query = new URLSearchParams({ state: callbackState ?? "" });
      if (this.callbackError !== null) {
        query.set("error", this.callbackError);
      } else {
        query.set("code", code);
      }
      const stateCookiePair = login.stateCookie.split(";", 1)[0];
      const cookie = [stateCookiePair, existingSessionCookie]
        .filter((value): value is string => value !== undefined)
        .join("; ");
      return this.runtime.handlers.GET(
        new Request(`${origin}/api/auth/callback/google?${query.toString()}`, {
          headers: { cookie }
        })
      );
    },
    async getSession(cookie: string) {
      return this.runtime.handlers.GET(
        new Request(`${origin}/api/auth/get-session`, {
          headers: { cookie }
        })
      );
    }
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requestURL =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      if (requestURL !== "https://oauth2.googleapis.com/token") {
        throw new Error("Unexpected outbound authentication request.");
      }

      const body = init?.body as URLSearchParams;
      const verifier = body.get("code_verifier") ?? "";
      const actualChallenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (
        harness.rejectTokenExchange ||
        actualChallenge !== expectedCodeChallenge
      ) {
        return Response.json(
          { error: "invalid_grant", error_description: "PKCE rejected" },
          { status: 400 }
        );
      }

      return Response.json({
        access_token: ACCESS_TOKEN,
        id_token: ID_TOKEN,
        expires_in: 3_600,
        token_type: "Bearer",
        scope: "openid email profile"
      });
    })
  );

  const environment: AuthEnvironment = {
    production,
    secret: "test-secret-that-is-at-least-thirty-two-characters",
    baseOrigin: origin,
    trustedOrigin: origin,
    googleClientId: CLIENT_ID,
    googleClientSecret: "google-client-secret",
    googleCallbackURL: `${origin}/api/auth/callback/google`
  };
  const flowStore: OAuthFlowStore = {
    async register(state) {
      replayGuards.add(state);
    },
    async consume(state) {
      return replayGuards.delete(state);
    },
    async abort(state) {
      replayGuards.delete(state);
      db.verification = db.verification.filter(
        (verification) => verification.identifier !== state
      );
    }
  };

  harness.runtime = createAuthRuntime({
    environment,
    database: memoryAdapter(db),
    flowStore,
    now,
    async verifyGoogleToken({ nonce }) {
      return {
        ...profile,
        nonce: typeof profile.nonce === "string" ? profile.nonce : nonce
      };
    },
    async revokeSessionToken(token) {
      if (harness.rejectSessionRevoke) {
        throw new Error("session revoke failed");
      }
      db.session = db.session.filter((session) => session.token !== token);
    },
    writeSafeLog(level) {
      safeLogs.push(level);
    }
  });

  return harness;
}

function cookieFromResponse(response: Response, name: string): string {
  return fullCookieFromResponse(response, name).split(";", 1)[0];
}

function fullCookieFromResponse(response: Response, name: string): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = headers.getSetCookie?.() ?? [
    response.headers.get("set-cookie") ?? ""
  ];
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (cookie === undefined) {
    throw new Error(`Expected ${name} cookie.`);
  }
  return cookie;
}

function createProtectedHandler(harness: Harness) {
  return createPersonalizationHandler(
    ({ auth }) => Response.json({ user_id: auth.user.id }),
    {
      requireSession: createRequireSession((input) =>
        harness.runtime.auth.api.getSession(input)
      ),
      trustedOrigin: LOCAL_ORIGIN,
      generateRequestId: () => "auth-integration-request-id",
      writeSafeLog: () => undefined
    }
  );
}

function protectedRequest(cookie: string): Request {
  return new Request(`${LOCAL_ORIGIN}/api/favorites`, {
    headers: { cookie }
  });
}
