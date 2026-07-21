import { describe, expect, it, vi } from "vitest";

import {
  AuthClientError,
  createGoogleSignInUrl,
  fetchBrowserAuthState,
  signOutBrowserSession
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
    ).resolves.toEqual({
      status: "authenticated",
      user: { id: "user-a" }
    });
    await expect(
      fetchBrowserAuthState(fetchOnce(jsonResponse(null, 503)))
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      fetchBrowserAuthState(fetchOnce(jsonResponse({ user: {} })))
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      fetchBrowserAuthState(fetchOnce(jsonResponse({}, 401)))
    ).resolves.toEqual({ status: "guest" });
  });

  it("keeps only validated safe user display fields", async () => {
    await expect(
      fetchBrowserAuthState(
        fetchOnce(
          jsonResponse({
            user: {
              id: " user-a ",
              name: " Display Name ",
              email: "not-an-email",
              image: "javascript:alert(1)",
              sessionToken: "must-not-escape"
            },
            session: { id: "secret-session", token: "secret-token" }
          })
        )
      )
    ).resolves.toEqual({
      status: "authenticated",
      user: { id: "user-a", name: "Display Name" }
    });
  });

  it("treats malformed JSON, network failures, and timeouts as unavailable", async () => {
    await expect(
      fetchBrowserAuthState(
        fetchOnce({
          ok: true,
          status: 200,
          json: async () => undefined
        } as Response)
      )
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      fetchBrowserAuthState(
        vi.fn(async () => Promise.reject(new Error("offline"))) as typeof fetch
      )
    ).resolves.toEqual({ status: "unavailable" });

    vi.useFakeTimers();
    try {
      const fetcher = abortablePendingFetch();
      const result = fetchBrowserAuthState(fetcher, 25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(result).resolves.toEqual({ status: "unavailable" });
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it.each(["/", "/favorites", "/settings"] as const)(
    "starts login with the exact %s callback",
    async (callbackURL) => {
      const fetcher = fetchOnce(
        jsonResponse({
          url: "https://accounts.google.com/o/oauth2/v2/auth?state=safe",
          redirect: true
        })
      );
      await createGoogleSignInUrl({ callbackURL, fetcher });
      expect(fetcher).toHaveBeenCalledWith(
        "/api/auth/sign-in/social",
        expect.objectContaining({
          body: JSON.stringify({ provider: "google", callbackURL })
        })
      );
    }
  );

  it("validates logout success and rejects malformed success payloads", async () => {
    const successfulFetcher = fetchOnce(jsonResponse({ success: true }));
    await expect(
      signOutBrowserSession({
        fetcher: successfulFetcher
      })
    ).resolves.toBeUndefined();
    expect(successfulFetcher).toHaveBeenCalledWith(
      "/api/auth/sign-out",
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: "{}"
      })
    );
    await expect(
      signOutBrowserSession({
        fetcher: fetchOnce(jsonResponse({ success: true, token: "unsafe" }))
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AuthClientError>>({
        code: "INVALID_AUTH_RESPONSE",
        retryable: true
      })
    );
  });

  it("aborts a timed-out logout as a retryable failure", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = abortablePendingFetch();
      const result = signOutBrowserSession({
        fetcher,
        requestTimeoutMs: 25
      });
      const rejection = expect(result).rejects.toEqual(
        expect.objectContaining<Partial<AuthClientError>>({
          code: "AUTH_UNAVAILABLE",
          retryable: true
        })
      );
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

function abortablePendingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("request aborted")),
          { once: true }
        );
      })
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
