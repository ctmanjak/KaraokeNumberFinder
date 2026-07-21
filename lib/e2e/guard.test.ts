import { describe, expect, it } from "vitest";

import { isBrowserE2EEnabled, isBrowserE2ERequest } from "./guard";

const E2E_DATABASE_URL =
  "postgresql://prisma:prisma@127.0.0.1:5432/karaoke_number_finder_m3_test";
const E2E_ORIGIN = "https://127.0.0.1:3443";

function e2eEnvironment(
  overrides: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    KNF_RUNTIME_ENV: "e2e",
    KNF_E2E_AUTH_ENABLED: "1",
    DATABASE_URL: E2E_DATABASE_URL,
    M3_TEST_DATABASE_URL: E2E_DATABASE_URL,
    BETTER_AUTH_URL: E2E_ORIGIN,
    ...overrides
  } as NodeJS.ProcessEnv;
}

describe("browser E2E authentication boundary", () => {
  it("opens only for the explicit HTTPS loopback E2E runtime and dedicated DB", () => {
    expect(isBrowserE2EEnabled(e2eEnvironment())).toBe(true);
  });

  it.each([
    ["missing opt-in", { KNF_E2E_AUTH_ENABLED: undefined }],
    ["production runtime", { KNF_RUNTIME_ENV: "production" }],
    ["development server", { NODE_ENV: "development" }],
    ["remote app origin", { BETTER_AUTH_URL: "https://app.example.com" }],
    [
      "non-test DB",
      {
        DATABASE_URL:
          "postgresql://prisma:prisma@127.0.0.1:5432/karaoke_number_finder",
        M3_TEST_DATABASE_URL:
          "postgresql://prisma:prisma@127.0.0.1:5432/karaoke_number_finder"
      }
    ],
    [
      "remote DB",
      {
        DATABASE_URL:
          "postgresql://prisma:prisma@db.example.com:5432/karaoke_number_finder_m3_test",
        M3_TEST_DATABASE_URL:
          "postgresql://prisma:prisma@db.example.com:5432/karaoke_number_finder_m3_test"
      }
    ],
    ["mismatched application DB", { DATABASE_URL: `${E2E_DATABASE_URL}?x=1` }]
  ])("fails closed for %s", (_name, overrides) => {
    expect(isBrowserE2EEnabled(e2eEnvironment(overrides))).toBe(false);
  });

  it("requires an exact same-origin browser control request", () => {
    const validRequest = new Request(`${E2E_ORIGIN}/api/e2e/control`, {
      headers: {
        origin: E2E_ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-knf-e2e-test": "1"
      }
    });
    const crossSiteRequest = new Request(`${E2E_ORIGIN}/api/e2e/control`, {
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "x-knf-e2e-test": "1"
      }
    });

    expect(isBrowserE2ERequest(validRequest, e2eEnvironment())).toBe(true);
    expect(isBrowserE2ERequest(crossSiteRequest, e2eEnvironment())).toBe(false);
  });

  it("accepts an exact HTTPS origin forwarded by the local reverse proxy", () => {
    const proxiedRequest = new Request(
      "http://127.0.0.1:3100/api/e2e/control",
      {
        headers: {
          origin: E2E_ORIGIN,
          "x-forwarded-host": "127.0.0.1:3443",
          "x-forwarded-proto": "https",
          "x-knf-e2e-test": "1"
        }
      }
    );
    const forgedProxyRequest = new Request(
      "http://127.0.0.1:3100/api/e2e/control",
      {
        headers: {
          origin: E2E_ORIGIN,
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
          "x-knf-e2e-test": "1"
        }
      }
    );

    expect(isBrowserE2ERequest(proxiedRequest, e2eEnvironment())).toBe(true);
    expect(isBrowserE2ERequest(forgedProxyRequest, e2eEnvironment())).toBe(
      false
    );
  });
});
