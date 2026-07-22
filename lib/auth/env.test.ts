import { describe, expect, it } from "vitest";

import { AuthEnvironmentError, readAuthEnvironment } from "./env";

const SECRET = "test-secret-that-is-at-least-thirty-two-characters";

describe("readAuthEnvironment", () => {
  it("accepts explicit loopback HTTP values for local development", () => {
    expect(
      readAuthEnvironment({
        NODE_ENV: "development",
        BETTER_AUTH_SECRET: SECRET,
        BETTER_AUTH_URL: "http://localhost:3000",
        AUTH_TRUSTED_ORIGIN: "http://localhost:3000",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        GOOGLE_OAUTH_CALLBACK_URL:
          "http://localhost:3000/api/auth/callback/google"
      })
    ).toMatchObject({
      production: false,
      baseOrigin: "http://localhost:3000",
      trustedOrigin: "http://localhost:3000"
    });
  });

  it("requires HTTPS and exact origins in production", () => {
    expect(() =>
      readAuthEnvironment({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: SECRET,
        BETTER_AUTH_URL: "http://example.com",
        AUTH_TRUSTED_ORIGIN: "http://example.com",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        GOOGLE_OAUTH_CALLBACK_URL: "http://example.com/api/auth/callback/google"
      })
    ).toThrow(AuthEnvironmentError);

    expect(() =>
      readAuthEnvironment({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: SECRET,
        BETTER_AUTH_URL: "https://example.com",
        AUTH_TRUSTED_ORIGIN: "https://other.example.com",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        GOOGLE_OAUTH_CALLBACK_URL:
          "https://example.com/api/auth/callback/google"
      })
    ).toThrow("AUTH_TRUSTED_ORIGIN must exactly match BETTER_AUTH_URL");
  });

  it("rejects the documented placeholder secret in production", () => {
    expect(() =>
      readAuthEnvironment({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET:
          "replace-with-a-random-secret-of-at-least-32-characters",
        BETTER_AUTH_URL: "https://example.com",
        AUTH_TRUSTED_ORIGIN: "https://example.com",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        GOOGLE_OAUTH_CALLBACK_URL:
          "https://example.com/api/auth/callback/google"
      })
    ).toThrow(
      "BETTER_AUTH_SECRET must replace the documented example value in production"
    );
  });

  it("rejects wildcard origins and a non-exact callback URI", () => {
    const base = {
      NODE_ENV: "production" as const,
      BETTER_AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: "https://example.com",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret"
    };

    expect(() =>
      readAuthEnvironment({
        ...base,
        AUTH_TRUSTED_ORIGIN: "https://*.example.com",
        GOOGLE_OAUTH_CALLBACK_URL:
          "https://example.com/api/auth/callback/google"
      })
    ).toThrow(AuthEnvironmentError);

    expect(() =>
      readAuthEnvironment({
        ...base,
        AUTH_TRUSTED_ORIGIN: "https://example.com",
        GOOGLE_OAUTH_CALLBACK_URL:
          "https://example.com/api/auth/callback/google/"
      })
    ).toThrow("GOOGLE_OAUTH_CALLBACK_URL must exactly match");
  });

  it("does not include secret values in validation errors", () => {
    const leakedValue = "short-secret";
    let message = "";

    try {
      readAuthEnvironment({
        NODE_ENV: "test",
        BETTER_AUTH_SECRET: leakedValue,
        BETTER_AUTH_URL: "http://localhost:3000",
        AUTH_TRUSTED_ORIGIN: "http://localhost:3000",
        GOOGLE_CLIENT_ID: "client",
        GOOGLE_CLIENT_SECRET: "provider-secret",
        GOOGLE_OAUTH_CALLBACK_URL:
          "http://localhost:3000/api/auth/callback/google"
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(leakedValue);
    expect(message).not.toContain("provider-secret");
  });
});
