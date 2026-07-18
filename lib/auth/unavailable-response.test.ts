import { describe, expect, it } from "vitest";

import { authCookiePolicy } from "./policy";
import { createUnavailableAuthResponse } from "./unavailable-response";

describe("createUnavailableAuthResponse", () => {
  it("expires the production state cookie when callback initialization fails", () => {
    const response = createUnavailableAuthResponse(
      new Request(
        "https://example.com/api/auth/callback/google?code=secret&state=secret"
      ),
      true
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/?auth_error=OAUTH_FAILED");
    expect(response.headers.get("set-cookie")).toBe(
      `${authCookiePolicy(true).stateCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`
    );
  });

  it("returns generic success and expires the local session cookie on logout failure", async () => {
    const response = createUnavailableAuthResponse(
      new Request("http://localhost:3000/api/auth/sign-out", {
        method: "POST"
      }),
      false
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get("set-cookie")).toBe(
      `${authCookiePolicy(false).sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
    );
  });

  it("keeps unrelated auth initialization failures generic", async () => {
    const response = createUnavailableAuthResponse(
      new Request("https://example.com/api/auth/get-session"),
      true
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is unavailable."
      }
    });
  });
});
