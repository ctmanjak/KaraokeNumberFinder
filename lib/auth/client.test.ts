import { describe, expect, it, vi } from "vitest";

import {
  AuthClientError,
  createGoogleSignInUrl,
  fetchBrowserAuthState
} from "./client";

describe("browser auth client", () => {
  it("distinguishes a guest from authenticated and unavailable states", async () => {
    await expect(
      fetchBrowserAuthState(fetchOnce(jsonResponse(null)))
    ).resolves.toEqual({ status: "guest" });
    await expect(
      fetchBrowserAuthState(
        fetchOnce(jsonResponse({ user: { id: "user-a" }, session: {} }))
      )
    ).resolves.toEqual({ status: "authenticated" });
    await expect(
      fetchBrowserAuthState(fetchOnce(jsonResponse(null, 503)))
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      fetchBrowserAuthState(fetchOnce(jsonResponse({ user: {} })))
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("starts Google login with the exact favorites callback and validates the URL", async () => {
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?state=state&code_challenge=challenge";
    const fetcher = fetchOnce(jsonResponse({ url, redirect: true }));

    await expect(
      createGoogleSignInUrl({ callbackURL: "/favorites", fetcher })
    ).resolves.toBe(url);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/sign-in/social",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/favorites"
        })
      })
    );
  });

  it("rejects an unsafe or malformed login URL as retryable", async () => {
    const promise = createGoogleSignInUrl({
      fetcher: fetchOnce(
        jsonResponse({ url: "https://evil.example/login", redirect: true })
      )
    });

    await expect(promise).rejects.toEqual(
      expect.objectContaining<Partial<AuthClientError>>({
        code: "INVALID_AUTH_RESPONSE",
        retryable: true
      })
    );
  });
});

function fetchOnce(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}
