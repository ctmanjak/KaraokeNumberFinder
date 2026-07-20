import { describe, expect, it, vi } from "vitest";
import { fetchProviders, fetchSearchResults } from "./search-ui";

describe("search UI API helpers", () => {
  it("uses the provider fallback message when an error response is not JSON", async () => {
    const fetcher = mockFetch({
      ok: false,
      json: async () => {
        throw new Error("Invalid JSON");
      }
    });

    await expect(fetchProviders(fetcher)).rejects.toThrow(
      "제공사 목록을 불러오지 못했습니다."
    );
  });

  it("uses the search fallback message when an error response is not JSON", async () => {
    const fetcher = mockFetch({
      ok: false,
      json: async () => {
        throw new Error("Invalid JSON");
      }
    });

    await expect(
      fetchSearchResults({ query: "sample query" }, fetcher)
    ).rejects.toThrow("검색 요청에 실패했습니다.");
  });

  it("uses the provider fallback message when a successful response is not JSON", async () => {
    const fetcher = mockFetch({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      }
    });

    await expect(fetchProviders(fetcher)).rejects.toThrow(
      "제공사 목록을 불러오지 못했습니다."
    );
  });

  it("uses the provider fallback message when a successful response is null", async () => {
    const fetcher = mockFetch({
      ok: true,
      json: async () => null
    });

    await expect(fetchProviders(fetcher)).rejects.toThrow(
      "제공사 목록을 불러오지 못했습니다."
    );
  });

  it("uses the search fallback message when a successful response is not JSON", async () => {
    const fetcher = mockFetch({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      }
    });

    await expect(
      fetchSearchResults({ query: "sample query" }, fetcher)
    ).rejects.toThrow("검색 요청에 실패했습니다.");
  });

  it("uses the search fallback message when a successful response is null", async () => {
    const fetcher = mockFetch({
      ok: true,
      json: async () => null
    });

    await expect(
      fetchSearchResults({ query: "sample query" }, fetcher)
    ).rejects.toThrow("검색 요청에 실패했습니다.");
  });

  it("aborts a provider request when its timeout expires", async () => {
    vi.useFakeTimers();

    try {
      const fetcher = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true }
            );
          })
      ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
      const result = fetchProviders(fetcher, { requestTimeoutMs: 25 });
      const expectation = expect(result).rejects.toThrow(
        "제공사 목록 요청 시간이 초과되었습니다."
      );

      await vi.advanceTimersByTimeAsync(25);

      await expectation;
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

function mockFetch(response: Pick<Response, "json" | "ok">): typeof fetch {
  return vi.fn(async () => response as Response) as typeof fetch;
}
