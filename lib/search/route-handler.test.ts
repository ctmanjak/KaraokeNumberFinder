import { describe, expect, it, vi } from "vitest";

import { InvalidProviderError, type SearchResponse } from "./search";
import { createSearchGetHandler } from "./route-handler";

describe("createSearchGetHandler", () => {
  it("returns search results as JSON", async () => {
    const GET = createSearchGetHandler(async (query) => ({
      query: query.query,
      normalized_query: query.normalizedQuery,
      items: [],
      next_cursor: null,
      suggestions: []
    }));

    const response = await GET(
      new Request("http://localhost/api/search?q=Fixture%20Query")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: "Fixture Query",
      normalized_query: "fixturequery",
      items: [],
      next_cursor: null,
      suggestions: []
    });
  });

  it("emits diagnostic timing headers only when requested", async () => {
    const GET = createSearchGetHandler(async (query, context) => {
      context?.timing?.record("test.search", 12.345);

      return {
        query: query.query,
        normalized_query: query.normalizedQuery,
        items: [],
        next_cursor: null,
        suggestions: []
      };
    });

    const normalResponse = await GET(
      new Request("http://localhost/api/search?q=Fixture")
    );
    const debugResponse = await GET(
      new Request("http://localhost/api/search?q=Fixture", {
        headers: { "x-perf-timing": "1" }
      })
    );

    expect(normalResponse.headers.has("x-perf-timing")).toBe(false);
    expect(debugResponse.headers.has("server-timing")).toBe(true);

    const timings = JSON.parse(
      debugResponse.headers.get("x-perf-timing") ?? "[]"
    ) as Array<{ name: string; duration_ms: number }>;

    expect(timings.map((timing) => timing.name)).toEqual(
      expect.arrayContaining([
        "route.parse",
        "test.search",
        "route.search",
        "route.json",
        "route.total"
      ])
    );
    expect(
      timings.find((timing) => timing.name === "test.search")?.duration_ms
    ).toBe(12.35);
  });

  it("does not emit diagnostic timing headers in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    try {
      const GET = createSearchGetHandler(async (query, context) => {
        context?.timing?.record("test.search", 12.345);

        return {
          query: query.query,
          normalized_query: query.normalizedQuery,
          items: [],
          next_cursor: null,
          suggestions: []
        };
      });

      const response = await GET(
        new Request("http://localhost/api/search?q=Fixture&__perf_timing=1", {
          headers: { "x-perf-timing": "1" }
        })
      );

      expect(response.headers.has("x-perf-timing")).toBe(false);
      expect(response.headers.has("server-timing")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns a 400 error for missing q", async () => {
    const GET = createSearchGetHandler(async () => emptyResponse());

    const response = await GET(new Request("http://localhost/api/search"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "q must contain at least one non-whitespace character."
      }
    });
  });

  it("returns a 400 error for blank q", async () => {
    const GET = createSearchGetHandler(async () => emptyResponse());

    const response = await GET(
      new Request("http://localhost/api/search?q=%20")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "q must contain at least one non-whitespace character."
      }
    });
  });

  it("returns a 400 error for invalid limit values", async () => {
    const GET = createSearchGetHandler(async () => emptyResponse());

    const response = await GET(
      new Request("http://localhost/api/search?q=fixture&limit=51")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "limit must be an integer between 1 and 50."
      }
    });
  });

  it("returns a 400 error for invalid provider_id values", async () => {
    const GET = createSearchGetHandler(async () => {
      throw new InvalidProviderError("provider_missing");
    });

    const response = await GET(
      new Request(
        "http://localhost/api/search?q=fixture&provider_id=provider_missing"
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_PROVIDER",
        message: "provider_id must reference an active provider."
      }
    });
  });

  it("returns a sanitized 500 error when search lookup fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const GET = createSearchGetHandler(async () => {
      throw new Error("database connection details");
    });

    const response = await GET(
      new Request("http://localhost/api/search?q=fixture")
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SEARCH_FAILED",
        message: "Failed to search songs."
      }
    });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("returns a timeout error when search lookup exceeds the request timeout", async () => {
    vi.useFakeTimers();

    try {
      const GET = createSearchGetHandler(
        async () => new Promise<SearchResponse>(() => undefined),
        { timeoutMs: 1 }
      );
      const responsePromise = GET(
        new Request("http://localhost/api/search?q=fixture")
      );

      await vi.advanceTimersByTimeAsync(1);

      const response = await responsePromise;

      expect(response.status).toBe(504);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "SEARCH_TIMEOUT",
          message: "Search timed out."
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

function emptyResponse(): SearchResponse {
  return {
    query: "fixture",
    normalized_query: "fixture",
    items: [],
    next_cursor: null,
    suggestions: []
  };
}
