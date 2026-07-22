import { prismaAdapter } from "@better-auth/prisma-adapter";
import { describe, expect, it } from "vitest";

import type { AuthEnvironment } from "./env";
import { createAuthOptions } from "./options";
import {
  OAUTH_STATE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SESSION_UPDATE_AGE_SECONDS
} from "./policy";

const productionEnvironment: AuthEnvironment = {
  production: true,
  secret: "test-secret-that-is-at-least-thirty-two-characters",
  baseOrigin: "https://example.com",
  trustedOrigin: "https://example.com",
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  googleCallbackURL: "https://example.com/api/auth/callback/google"
};

describe("createAuthOptions", () => {
  it("uses the official Prisma adapter with the custom client boundary", () => {
    const database = prismaAdapter({} as never, {
      provider: "postgresql",
      transaction: true
    });
    const options = createAuthOptions(productionEnvironment, { database });
    const adapter = database(options);

    expect(adapter.id).toBe("prisma");
  });

  it("enables only Google code flow, UUID IDs, and database sessions", () => {
    const options = createOptions();
    const google = options.socialProviders?.google;

    if (typeof google !== "object" || google === null) {
      throw new Error("Expected static Google provider options.");
    }

    expect(Object.keys(options.socialProviders ?? {})).toEqual(["google"]);
    expect(options.emailAndPassword?.enabled).toBe(false);
    expect(google.disableIdTokenSignIn).toBe(true);
    expect(options.advanced?.database?.generateId).toBe("uuid");
    expect(options.account?.storeStateStrategy).toBe("database");
    expect(options.account?.storeAccountCookie).toBe(false);
    expect(options.account?.accountLinking).toMatchObject({
      enabled: false,
      disableImplicitLinking: true,
      trustedProviders: [],
      allowDifferentEmails: false
    });
    expect(options.session).toMatchObject({
      expiresIn: SESSION_IDLE_TTL_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: false }
    });
  });

  it("builds the exact production Host cookie policy", () => {
    const options = createOptions();

    expect(options.advanced).toMatchObject({
      useSecureCookies: false,
      cookiePrefix: "__Host-knf",
      defaultCookieAttributes: {
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      },
      cookies: {
        state: { attributes: { maxAge: OAUTH_STATE_TTL_SECONDS } },
        session_token: {
          attributes: {
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            path: "/"
          }
        }
      }
    });
    expect(options.advanced?.defaultCookieAttributes).not.toHaveProperty(
      "domain"
    );
  });

  it("strips all OAuth token material before Account writes", async () => {
    const options = createOptions();
    const before = options.databaseHooks?.account?.create?.before;
    const result = await before?.(
      {
        id: "account-id",
        userId: "user-id",
        providerId: "google",
        accountId: "google-sub",
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        idToken: "id-secret",
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
        scope: "openid email profile",
        password: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      null
    );

    expect(result).toMatchObject({
      data: {
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null
      }
    });
  });
});

function createOptions() {
  return createAuthOptions(productionEnvironment, {
    database: (() => ({ id: "test" })) as never
  });
}
