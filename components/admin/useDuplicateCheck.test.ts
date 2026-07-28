// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  duplicateInputError,
  duplicateInputErrors,
  useDuplicateCheck
} from "./useDuplicateCheck";

describe("administrator duplicate-check input state", () => {
  const valid = {
    originalLanguage: "ja",
    canonicalTitle: "Lemon",
    displayTitle: "레몬",
    canonicalArtist: "米津玄師"
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("distinguishes field-specific normalization and length errors from idle input", () => {
    expect(duplicateInputError(valid)).toBeNull();
    expect(
      duplicateInputErrors({
        ...valid,
        canonicalTitle: "---",
        displayTitle: "",
        canonicalArtist: "a".repeat(513)
      })
    ).toEqual({
      canonical_title: "원제에 검색 가능한 문자를 입력해 주세요.",
      display_title: "표시 제목을 입력해 주세요.",
      canonical_artist: "가수는 512자 이하로 입력해 주세요."
    });
  });

  it("waits for the 500ms trailing edge and applies only the current fingerprint", async () => {
    vi.useFakeTimers();
    const first = deferred<Response>();
    const calls: RequestInit[] = [];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(init ?? {});
        if (calls.length === 1) return first.promise;
        return jsonResponse({ classification: "none", candidates: [] });
      }
    );
    vi.stubGlobal("fetch", fetcher);
    const onCatalogDisabled = vi.fn();
    const { result, rerender } = renderHook(
      ({ canonicalTitle }) =>
        useDuplicateCheck({
          identityChanged: true,
          catalogDisabled: false,
          identity: { ...valid, canonicalTitle },
          onCatalogDisabled
        }),
      { initialProps: { canonicalTitle: "Lemon" } }
    );

    await advance(499);
    expect(fetcher).not.toHaveBeenCalled();
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    rerender({ canonicalTitle: "Lemon 2" });
    expect((calls[0].signal as AbortSignal).aborted).toBe(true);
    await advance(500);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await flush();
    expect(result.current.state.status).toBe("none");

    first.resolve(
      jsonResponse({
        classification: "exact",
        candidates: [candidate("stale-song")]
      })
    );
    await flush();
    expect(result.current.state.status).toBe("none");
  });

  it("automatically retries network failures once after one second", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(
        jsonResponse({ classification: "none", candidates: [] })
      );
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderDuplicateHook();

    await advance(500);
    await flush();
    expect(result.current.state.status).toBe("retrying");
    await advance(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.state.status).toBe("none");
  });

  it("does not auto-retry 429 and makes a manual retry immediate without a new auto budget", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Slow down."
            }
          },
          429,
          { "retry-after": "7" }
        )
      )
      .mockRejectedValueOnce(new TypeError("manual network failure"));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderDuplicateHook();

    await advance(500);
    await flush();
    expect(result.current.state).toMatchObject({
      status: "error",
      retryAfter: "7"
    });
    await advance(2_000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await advance(0);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.state.status).toBe("error");
    await advance(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

function renderDuplicateHook() {
  const onCatalogDisabled = vi.fn();
  return renderHook(() =>
    useDuplicateCheck({
      identityChanged: true,
      catalogDisabled: false,
      identity: {
        originalLanguage: "ja",
        canonicalTitle: "Lemon",
        displayTitle: "레몬",
        canonicalArtist: "米津玄師"
      },
      onCatalogDisabled
    })
  );
}

async function advance(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function candidate(id: string) {
  return {
    id,
    display_title: "레몬",
    canonical_title: "Lemon",
    canonical_artist: "米津玄師",
    original_language: "ja",
    release_year: 2018,
    tie_in: null,
    provider_summary: [],
    match_evidence: [],
    admin_path: `/admin/songs/${id}`
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
