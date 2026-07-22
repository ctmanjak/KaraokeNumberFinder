// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROVIDER_STORAGE_KEY } from "@/lib/preferences/default-provider-storage";
import { SEARCH_HISTORY_STORAGE_KEY } from "@/lib/search-history/storage";
import { MobileSearchPage } from "./MobileSearchPage";

const providers = [
  {
    id: "provider_secondary",
    name: "Generic Provider Secondary",
    country: "KR",
    is_active: true,
    display_order: 20,
    is_default: false,
    last_catalog_updated_at: null
  },
  {
    id: "provider_tertiary",
    name: "Generic Provider Tertiary",
    country: "KR",
    is_active: true,
    display_order: 30,
    is_default: false,
    last_catalog_updated_at: null
  },
  {
    id: "provider_quaternary",
    name: "Generic Provider Quaternary",
    country: "KR",
    is_active: true,
    display_order: 40,
    is_default: false,
    last_catalog_updated_at: null
  },
  {
    id: "provider_without_entry",
    name: "Generic Provider Without Entry",
    country: "KR",
    is_active: true,
    display_order: 50,
    is_default: false,
    last_catalog_updated_at: null
  },
  {
    id: "provider_default",
    name: "Generic Provider Default",
    country: "KR",
    is_active: true,
    display_order: 10,
    is_default: true,
    last_catalog_updated_at: null
  }
];

const searchResponse = {
  query: "sample title",
  normalized_query: "sampletitle",
  items: [
    {
      song: {
        id: "song_sample_001",
        original_language: "ja",
        canonical_title: "Sample Canonical Title",
        display_title: "Sample Display Title",
        canonical_artist: "Sample Artist",
        release_year: 2026,
        tie_in: "Sample Tie In",
        matched_aliases: [
          {
            id: "alias_sample_001",
            alias: "Sample Matched Alias",
            language: "en",
            alias_type: "translated_title"
          }
        ]
      },
      karaoke_entries: [
        {
          id: "entry_default_available",
          provider_id: "provider_default",
          karaoke_number: "12345",
          version_info: "Sample Original Version",
          availability_status: "available",
          last_verified_at: "2026-01-02",
          is_stale: false
        },
        {
          id: "entry_secondary_not_available",
          provider_id: "provider_secondary",
          karaoke_number: "",
          version_info: "Sample Alternate Version",
          availability_status: "not_available",
          last_verified_at: null,
          is_stale: false
        },
        {
          id: "entry_default_available_variant",
          provider_id: "provider_default",
          karaoke_number: "67890",
          version_info: "Sample Variant Version",
          availability_status: "available",
          last_verified_at: "2026-01-03",
          is_stale: false
        },
        {
          id: "entry_tertiary_temporarily_unavailable",
          provider_id: "provider_tertiary",
          karaoke_number: "",
          version_info: "Sample Live Version",
          availability_status: "temporarily_unavailable",
          last_verified_at: "2025-01-01",
          is_stale: true
        },
        {
          id: "entry_quaternary_unknown",
          provider_id: "provider_quaternary",
          karaoke_number: "",
          version_info: "",
          availability_status: "unknown",
          last_verified_at: null,
          is_stale: false
        }
      ],
      distinguishing_labels: ["Sample Artist", "Sample Tie In", "2026"],
      relevance_score: 100
    }
  ],
  next_cursor: null,
  suggestions: []
};

describe("MobileSearchPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads providers and selects the default provider", async () => {
    mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_default");
    });
  });

  it("falls back to the first active provider in operational order when no default exists", async () => {
    mockFetch([
      {
        ok: true,
        body: {
          items: providers.map((provider) => ({
            ...provider,
            is_default: false
          }))
        }
      }
    ]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_default");
    });
  });

  it("restores a guest provider selection on a later browser visit", async () => {
    window.localStorage.setItem(
      DEFAULT_PROVIDER_STORAGE_KEY,
      JSON.stringify({ version: 1, provider_id: "provider_secondary" })
    );
    mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_secondary");
    });
    expect(
      window.localStorage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)
    ).not.toBeNull();
  });

  it("discards a removed local provider and restores the operational default", async () => {
    window.localStorage.setItem(
      DEFAULT_PROVIDER_STORAGE_KEY,
      JSON.stringify({ version: 1, provider_id: "provider-removed" })
    );
    mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_default");
      expect(
        window.localStorage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)
      ).toBeNull();
    });
  });

  it("lets an authenticated server user setting win and removes local state", async () => {
    window.localStorage.setItem(
      DEFAULT_PROVIDER_STORAGE_KEY,
      JSON.stringify({ version: 1, provider_id: "provider_secondary" })
    );
    mockFetchWithPreference([{ ok: true, body: { items: providers } }], {
      get: { ok: true, body: preferencePayload("provider_tertiary", "user") }
    });

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_tertiary");
      expect(
        window.localStorage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)
      ).toBeNull();
    });
  });

  it("seeds an authenticated user from valid local state and removes it only after success", async () => {
    window.localStorage.setItem(
      DEFAULT_PROVIDER_STORAGE_KEY,
      JSON.stringify({ version: 1, provider_id: "provider_secondary" })
    );
    const fetchMock = mockFetchWithPreference(
      [{ ok: true, body: { items: providers } }],
      {
        get: {
          ok: true,
          body: preferencePayload("provider_default", "operational_default")
        },
        put: { ok: true, body: preferencePayload("provider_secondary", "user") }
      }
    );

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_secondary");
      expect(
        window.localStorage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)
      ).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/user-preference/default-provider",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ provider_id: "provider_secondary" })
      })
    );
  });

  it("keeps local state and public search usable when server seeding fails", async () => {
    window.localStorage.setItem(
      DEFAULT_PROVIDER_STORAGE_KEY,
      JSON.stringify({ version: 1, provider_id: "provider_secondary" })
    );
    const fetchMock = mockFetchWithPreference(
      [
        { ok: true, body: { items: providers } },
        { ok: true, body: searchResponse }
      ],
      {
        get: {
          ok: true,
          body: preferencePayload("provider_default", "operational_default")
        },
        put: { ok: false, status: 500, body: {} }
      }
    );

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_secondary");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/user-preference/default-provider",
        expect.any(Object)
      );
    });
    expect(
      window.localStorage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)
    ).not.toBeNull();

    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search?q=sample+title&provider_id=provider_secondary",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("stores the latest authenticated selection locally while an earlier PUT is pending", async () => {
    const firstPut = deferred<Response>();
    let putCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url === "/api/providers") {
          return jsonResponse({ items: providers });
        }

        if (url === "/api/user-preference") {
          return jsonResponse(preferencePayload("provider_tertiary", "user"));
        }

        if (url === "/api/user-preference/default-provider") {
          putCount += 1;
          if (putCount === 1) {
            return firstPut.promise;
          }

          return jsonResponse(preferencePayload("provider_secondary", "user"));
        }

        throw new Error(`Unexpected fetch call: ${url} (${init?.method})`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_tertiary");
    });

    fireEvent.change(select, { target: { value: "provider_default" } });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input]) =>
            input.toString() === "/api/user-preference/default-provider"
        )
      ).toHaveLength(1);
    });

    fireEvent.change(select, { target: { value: "provider_secondary" } });

    expect(window.localStorage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, provider_id: "provider_secondary" })
    );

    firstPut.resolve(
      jsonResponse(preferencePayload("provider_default", "user"))
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input]) =>
            input.toString() === "/api/user-preference/default-provider"
        )
      ).toHaveLength(2);
      expect(
        window.localStorage.getItem(DEFAULT_PROVIDER_STORAGE_KEY)
      ).toBeNull();
    });
  });

  it("keeps search usable when localStorage access throws", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search?q=sample+title&provider_id=provider_default",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("does not call search API before submit or while typing", async () => {
    const fetchMock = mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        input.toString().startsWith("/api/search")
      )
    ).toHaveLength(0);
  });

  it("calls search API when the search button submits", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=sample+title&provider_id=provider_default",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("calls search API when Enter submits", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=sample+title&provider_id=provider_default",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("does not call search API for a blank query", async () => {
    const fetchMock = mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "   " }
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        input.toString().startsWith("/api/search")
      )
    ).toHaveLength(0);
  });

  it("includes the selected provider_id in search requests", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    await waitFor(() => {
      expect((select as HTMLSelectElement).value).toBe("provider_default");
    });
    fireEvent.change(select, { target: { value: "provider_secondary" } });
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=sample+title&provider_id=provider_secondary",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("keeps the submitted provider in the result summary until a new search submits", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    const { container } = render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("Sample Display Title");
    fireEvent.change(select, { target: { value: "provider_secondary" } });

    const summary = container.querySelector(".results-summary");

    expect(summary?.textContent).toContain("Generic Provider Default");
    expect(summary?.textContent).not.toContain("Generic Provider Secondary");
  });

  it("updates existing card priority immediately and uses the new provider for later searches", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    const card = await screen.findByLabelText("선택 제공사 번호");
    expect(card.textContent).toContain("12345");
    const searchCallsBeforeChange = fetchMock.mock.calls.filter(([input]) =>
      input.toString().startsWith("/api/search")
    );

    fireEvent.change(select, { target: { value: "provider_secondary" } });

    expect(card.textContent).toContain("미수록");
    expect(card.textContent).not.toContain("12345");
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        input.toString().startsWith("/api/search")
      )
    ).toHaveLength(searchCallsBeforeChange.length);

    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/search?q=sample+title&provider_id=provider_secondary",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it("ignores stale search responses when requests resolve out of order", async () => {
    const slowSearch = deferred<Response>();
    const fastSearch = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = input.toString();

      if (url === "/api/providers") {
        return Promise.resolve(jsonResponse({ items: providers }));
      }

      if (url === "/api/user-preference") {
        return Promise.resolve(unauthenticatedResponse());
      }

      if (url.startsWith("/api/search?q=slow")) {
        return slowSearch.promise;
      }

      if (url.startsWith("/api/search?q=fast")) {
        return fastSearch.promise;
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "slow" }
    });
    fireEvent.submit(screen.getByRole("search"));
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "fast" }
    });
    fireEvent.submit(screen.getByRole("search"));

    const slowCall = fetchMock.mock.calls.find(([input]) =>
      input.toString().startsWith("/api/search?q=slow")
    );
    expect((slowCall?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(
      true
    );

    fastSearch.resolve(
      jsonResponse(
        searchResponseWithSong({
          id: "song_fast_001",
          displayTitle: "Fast Display Title"
        })
      )
    );

    expect(await screen.findByText("Fast Display Title")).toBeTruthy();

    slowSearch.resolve(
      jsonResponse(
        searchResponseWithSong({
          id: "song_slow_001",
          displayTitle: "Slow Display Title"
        })
      )
    );

    await waitFor(() => {
      expect(screen.queryByText("Slow Display Title")).toBeNull();
      expect(screen.getByText("Fast Display Title")).toBeTruthy();
    });
  });

  it("renders a clear loading state during the first search", async () => {
    const pendingSearch = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();

      if (url === "/api/providers") {
        return Promise.resolve(jsonResponse({ items: providers }));
      }

      if (url === "/api/user-preference") {
        return Promise.resolve(unauthenticatedResponse());
      }

      if (url.startsWith("/api/search?q=sample")) {
        return pendingSearch.promise;
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    expect((await screen.findByRole("status")).textContent).toContain(
      "sample title 검색 결과를 불러오는 중입니다."
    );
    expect(
      (screen.getByRole("button", { name: "검색" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    pendingSearch.resolve(jsonResponse(searchResponse));
    await screen.findByText("Sample Display Title");
  });

  it("keeps existing results and shows a non-blocking loading banner during a new search", async () => {
    const secondSearch = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();

      if (url === "/api/providers") {
        return Promise.resolve(jsonResponse({ items: providers }));
      }

      if (url === "/api/user-preference") {
        return Promise.resolve(unauthenticatedResponse());
      }

      if (url.startsWith("/api/search?q=first")) {
        return Promise.resolve(jsonResponse(searchResponse));
      }

      if (url.startsWith("/api/search?q=second")) {
        return secondSearch.promise;
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "first" }
    });
    fireEvent.submit(screen.getByRole("search"));
    await screen.findByText("Sample Display Title");

    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "second" }
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(screen.getByText("Sample Display Title")).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toContain(
      "기존 결과를 유지합니다."
    );

    secondSearch.resolve(jsonResponse(searchResponse));
    await screen.findByText("Sample Display Title");
  });

  it("renders the result list shell after a successful search", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByText("Sample Display Title")).toBeTruthy();
    expect(screen.getByText("Sample Canonical Title")).toBeTruthy();
    expect(screen.getAllByText("Sample Artist").length).toBeGreaterThan(0);
    expect(screen.getByText("언어: 일본어")).toBeTruthy();
    expect(screen.getByText("일치한 별칭: Sample Matched Alias")).toBeTruthy();
    expect(screen.getByText("관련도 100")).toBeTruthy();
  });

  it("prioritizes the selected provider available number in the card default state", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByText("12345")).toBeTruthy();
    expect(
      screen.getAllByText("Generic Provider Default").length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Sample Original Version")).toBeTruthy();
    expect(screen.getByText("확인일 2026-01-02")).toBeTruthy();
  });

  it("falls back to a status label when an available selected-provider entry has no number", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      {
        ok: true,
        body: searchResponseWithEntries([
          {
            id: "entry_secondary_available_without_number",
            provider_id: "provider_secondary",
            karaoke_number: "",
            version_info: "Sample Missing Number Version",
            availability_status: "available",
            last_verified_at: "2026-01-04",
            is_stale: false
          },
          {
            id: "entry_default_available_for_badge",
            provider_id: "provider_default",
            karaoke_number: "12345",
            version_info: "Sample Original Version",
            availability_status: "available",
            last_verified_at: "2026-01-02",
            is_stale: false
          }
        ])
      }
    ]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    fireEvent.change(select, { target: { value: "provider_secondary" } });
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByText("확인 필요")).toBeTruthy();
    expect(screen.getByText("Sample Missing Number Version")).toBeTruthy();
    expect(screen.getByText("다른 제공사 번호 있음")).toBeTruthy();
  });

  it("shows another-provider badge when the selected provider has no available number", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    fireEvent.change(select, { target: { value: "provider_secondary" } });
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByText("미수록")).toBeTruthy();
    expect(screen.getByText("다른 제공사 번호 있음")).toBeTruthy();
  });

  it("toggles provider comparison with status, verification, and stale labels", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    const expandButton = await screen.findByRole("button", {
      name: "제공사별 비교"
    });
    fireEvent.click(expandButton);

    expect(screen.getByLabelText("제공사별 번호 비교")).toBeTruthy();
    expect(
      screen.getAllByText("Generic Provider Secondary").length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("사용 가능").length).toBeGreaterThan(0);
    expect(screen.getByText("67890")).toBeTruthy();
    expect(screen.getByText("Sample Variant Version")).toBeTruthy();
    expect(screen.getAllByText("미수록").length).toBeGreaterThan(0);
    expect(screen.getAllByText("일시 이용 불가").length).toBeGreaterThan(0);
    expect(screen.getAllByText("확인 필요").length).toBeGreaterThan(0);
    expect(screen.getAllByText("확인일 2026-01-02").length).toBeGreaterThan(0);
    expect(screen.getAllByText("확인일 정보 없음").length).toBeGreaterThan(0);
    expect(screen.getAllByText("오래된 정보").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Generic Provider Without Entry").length
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "접기" }));

    expect(screen.queryByLabelText("제공사별 번호 비교")).toBeNull();
  });

  it("resets expanded cards when a new search starts", async () => {
    const firstSearch = deferred<Response>();
    const secondSearch = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();

      if (url === "/api/providers") {
        return Promise.resolve(jsonResponse({ items: providers }));
      }

      if (url === "/api/user-preference") {
        return Promise.resolve(unauthenticatedResponse());
      }

      if (url.startsWith("/api/search?q=first")) {
        return firstSearch.promise;
      }

      if (url.startsWith("/api/search?q=second")) {
        return secondSearch.promise;
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "first" }
    });
    fireEvent.submit(screen.getByRole("search"));
    firstSearch.resolve(jsonResponse(searchResponse));

    fireEvent.click(
      await screen.findByRole("button", { name: "제공사별 비교" })
    );
    expect(screen.getByLabelText("제공사별 번호 비교")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "second" }
    });
    fireEvent.submit(screen.getByRole("search"));
    secondSearch.resolve(jsonResponse(searchResponse));

    await screen.findByText("Sample Display Title");

    expect(screen.queryByLabelText("제공사별 번호 비교")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "제공사별 비교" })
        .getAttribute("aria-expanded")
    ).toBe("false");
  });

  it("renders an error state after a failed search", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      {
        ok: false,
        status: 500,
        body: { error: { code: "SEARCH_FAILED", message: "Search failed." } }
      }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Search failed."
    );
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("keeps existing results and shows a non-blocking error with retry after a failed re-search", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse },
      {
        ok: false,
        status: 500,
        body: { error: { code: "SEARCH_FAILED", message: "Search failed." } }
      }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "first" }
    });
    fireEvent.submit(screen.getByRole("search"));
    await screen.findByText("Sample Display Title");

    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "second" }
    });
    fireEvent.submit(screen.getByRole("search"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Search failed."
    );
    expect(screen.getByText("Sample Display Title")).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=second&provider_id=provider_default",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("retries with the last submitted query and provider_id", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      {
        ok: false,
        status: 500,
        body: { error: { code: "SEARCH_FAILED", message: "Search failed." } }
      },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    fireEvent.change(select, { target: { value: "provider_secondary" } });
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "retry query" }
    });
    fireEvent.submit(screen.getByRole("search"));

    fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=retry+query&provider_id=provider_secondary",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("clears the previous non-blocking error after a successful new search", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse },
      {
        ok: false,
        status: 500,
        body: { error: { code: "SEARCH_FAILED", message: "Search failed." } }
      },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "first" }
    });
    fireEvent.submit(screen.getByRole("search"));
    await screen.findByText("Sample Display Title");

    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "second" }
    });
    fireEvent.submit(screen.getByRole("search"));
    await screen.findByRole("alert");

    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "third" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => {
      expect(screen.queryByText("Search failed.")).toBeNull();
    });
    expect(screen.getByText("Sample Display Title")).toBeTruthy();
  });

  it("renders the submitted query in the empty result state", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      {
        ok: true,
        body: {
          ...searchResponse,
          query: "confirmed missing title",
          items: [],
          suggestions: []
        }
      }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "missing title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(
      await screen.findByText('"confirmed missing title" 검색 결과가 없습니다.')
    ).toBeTruthy();
    expect(screen.queryByLabelText("유사 검색어")).toBeNull();
  });

  it("shows up to five suggestions in the empty result state", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      {
        ok: true,
        body: {
          ...searchResponse,
          items: [],
          suggestions: [
            "Suggestion One",
            "Suggestion Two",
            "Suggestion Three",
            "Suggestion Four",
            "Suggestion Five",
            "Suggestion Six"
          ]
        }
      }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "missing title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByLabelText("유사 검색어");

    expect(screen.getByRole("button", { name: "Suggestion One" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Suggestion Five" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Suggestion Six" })).toBeNull();
  });

  it("updates input and explicitly searches when a suggestion is clicked", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      {
        ok: true,
        body: {
          ...searchResponse,
          items: [],
          suggestions: ["Suggestion One"]
        }
      },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "missing title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    fireEvent.click(
      await screen.findByRole("button", { name: "Suggestion One" })
    );

    expect((screen.getByLabelText("검색어") as HTMLInputElement).value).toBe(
      "Suggestion One"
    );
    await screen.findByText("Sample Display Title");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=Suggestion+One&provider_id=provider_default",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("keeps search available when provider loading fails", async () => {
    const fetchMock = mockFetch([
      {
        ok: false,
        status: 500,
        body: {
          error: {
            code: "PROVIDER_LIST_FAILED",
            message: "Provider loading failed."
          }
        }
      },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    expect(await screen.findByText(/Provider loading failed/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=sample+title",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("records a successful guest search in localStorage", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByText("최근 검색어가 없습니다.");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "  sample title  " }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    await waitFor(() => {
      const stored = readStoredHistoryPayload();
      expect(stored.items).toHaveLength(1);
      expect(stored.items[0]).toMatchObject({
        query: "sample title",
        normalized_query: "sampletitle"
      });
      expect(screen.getByRole("button", { name: "sample title" })).toBeTruthy();
    });
  });

  it("does not record a failed guest search", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: false, status: 500, body: {} }
    ]);

    render(<MobileSearchPage />);
    await screen.findByText("최근 검색어가 없습니다.");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "failed query" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByRole("alert");
    expect(window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("does not record a timed-out guest search", async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          return Promise.resolve(jsonResponse(null));
        }
        if (url === "/api/providers") {
          return Promise.resolve(jsonResponse({ items: providers }));
        }
        if (url === "/api/user-preference") {
          return Promise.resolve(unauthenticatedResponse());
        }
        if (url.startsWith("/api/search?")) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);
    await screen.findByText("최근 검색어가 없습니다.");
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "timeout query" }
    });
    fireEvent.submit(screen.getByRole("search"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(screen.getByText("검색 요청 시간이 초과되었습니다.")).toBeTruthy();
    expect(window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("does not record an aborted stale search during rapid submissions", async () => {
    const slowSearch = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return Promise.resolve(jsonResponse(null));
      }
      if (url === "/api/providers") {
        return Promise.resolve(jsonResponse({ items: providers }));
      }
      if (url === "/api/user-preference") {
        return Promise.resolve(unauthenticatedResponse());
      }
      if (url.startsWith("/api/search?q=slow")) {
        return slowSearch.promise;
      }
      if (url.startsWith("/api/search?q=fast")) {
        return Promise.resolve(
          jsonResponse({
            ...searchResponse,
            query: "fast",
            normalized_query: "fast"
          })
        );
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);
    await screen.findByText("최근 검색어가 없습니다.");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "slow" }
    });
    fireEvent.submit(screen.getByRole("search"));
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "fast" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    slowSearch.resolve(
      jsonResponse({
        ...searchResponse,
        query: "slow",
        normalized_query: "slow"
      })
    );
    await waitFor(() => {
      expect(
        readStoredHistoryPayload().items.map(({ query }) => query)
      ).toEqual(["fast"]);
    });
  });

  it("loads and records authenticated server history without blocking results", async () => {
    const existing = serverHistoryItem(
      "Existing",
      "existing",
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "2026-07-20T01:00:00.000Z"
    );
    const recorded = serverHistoryItem(
      "sample title",
      "sampletitle",
      "cccccccc-cccc-4ccc-bccc-cccccccccccc",
      "2026-07-20T02:00:00.000Z"
    );
    const fetchMock = authenticatedFetch(({ url, init }) => {
      if (url === "/api/search-history" && init?.method === "POST") {
        return jsonResponse({ item: recorded });
      }
      if (url === "/api/search-history") {
        return jsonResponse({ items: [existing] });
      }
      if (url.startsWith("/api/search?")) {
        return jsonResponse(searchResponse);
      }
      return undefined;
    });

    render(<MobileSearchPage />);

    expect(
      await screen.findByRole("button", { name: "Existing" })
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "sample title" })).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search-history",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "sample title" })
      })
    );
    expect(window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("keeps authenticated search results when history POST fails", async () => {
    authenticatedFetch(({ url, init }) => {
      if (url === "/api/search-history" && init?.method === "POST") {
        return errorJsonResponse(500, "PERSONALIZATION_UNAVAILABLE");
      }
      if (url === "/api/search-history") {
        return jsonResponse({ items: [] });
      }
      if (url.startsWith("/api/search?")) {
        return jsonResponse(searchResponse);
      }
      return undefined;
    });

    render(<MobileSearchPage />);
    await screen.findByText("최근 검색어가 없습니다.");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(await screen.findByText("Sample Display Title")).toBeTruthy();
    expect(
      await screen.findByText(/서버에 최근 검색어를 기록하지 못했습니다/u)
    ).toBeTruthy();
  });

  it("handles a history POST 401 as session expiry and stores the search locally", async () => {
    authenticatedFetch(({ url, init }) => {
      if (url === "/api/search-history" && init?.method === "POST") {
        return errorJsonResponse(401, "UNAUTHENTICATED");
      }
      if (url === "/api/search-history") {
        return jsonResponse({ items: [] });
      }
      if (url.startsWith("/api/search?")) {
        return jsonResponse(searchResponse);
      }
      return undefined;
    });

    render(<MobileSearchPage />);
    await screen.findByText("최근 검색어가 없습니다.");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(await screen.findByText("Sample Display Title")).toBeTruthy();
    expect(
      await screen.findByText(/세션이 만료되어 이 검색어는 브라우저에 보관/u)
    ).toBeTruthy();
    expect(readStoredHistoryPayload().items[0]).toMatchObject({
      query: "sample title",
      normalized_query: "sampletitle"
    });
  });

  it("does not treat an auth 503 as guest or overwrite local history", async () => {
    seedLocalHistory([
      {
        query: "Local Existing",
        normalized_query: "localexisting",
        searched_at: "2026-07-20T01:00:00.000Z"
      }
    ]);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return Promise.resolve(
          errorJsonResponse(503, "PERSONALIZATION_UNAVAILABLE")
        );
      }
      if (url === "/api/providers") {
        return Promise.resolve(jsonResponse({ items: providers }));
      }
      if (url === "/api/user-preference") {
        return Promise.resolve(
          errorJsonResponse(503, "PERSONALIZATION_UNAVAILABLE")
        );
      }
      if (url.startsWith("/api/search?")) {
        return Promise.resolve(jsonResponse(searchResponse));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);
    expect(
      await screen.findByText(/로그인 상태를 확인하지 못해 최근 검색어/u)
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    expect(readStoredHistoryPayload().items.map(({ query }) => query)).toEqual([
      "Local Existing"
    ]);
  });

  it("merges local history once after login and clears it only after success", async () => {
    seedLocalHistory([
      {
        query: "Local Query",
        normalized_query: "localquery",
        searched_at: "2026-07-20T01:00:00.000Z"
      }
    ]);
    const merged = serverHistoryItem(
      "Local Query",
      "localquery",
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "2026-07-20T01:00:00.000Z"
    );
    const fetchMock = authenticatedFetch(({ url }) => {
      if (url === "/api/user-data/merge") {
        return jsonResponse(mergePayload([merged]));
      }
      return undefined;
    });

    render(<MobileSearchPage />);

    expect(
      await screen.findByRole("button", { name: "Local Query" })
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      ).toBeNull();
    });
    const mergeCall = fetchMock.mock.calls.find(
      ([input]) => input.toString() === "/api/user-data/merge"
    );
    const body = JSON.parse(String(mergeCall?.[1]?.body));
    expect(body).toMatchObject({
      recent_searches: [
        { query: "Local Query", searched_at: "2026-07-20T01:00:00.000Z" }
      ]
    });
    expect(body.merge_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    );
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => input.toString() === "/api/user-data/merge"
      )
    ).toHaveLength(1);
  });

  it("keeps local history after merge failure and retries with the same merge id", async () => {
    seedLocalHistory([
      {
        query: "Retry Query",
        normalized_query: "retryquery",
        searched_at: "2026-07-20T01:00:00.000Z"
      }
    ]);
    const merged = serverHistoryItem(
      "Retry Query",
      "retryquery",
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "2026-07-20T01:00:00.000Z"
    );
    let mergeCount = 0;
    const fetchMock = authenticatedFetch(({ url }) => {
      if (url === "/api/user-data/merge") {
        mergeCount += 1;
        return mergeCount === 1
          ? errorJsonResponse(500, "PERSONALIZATION_UNAVAILABLE")
          : jsonResponse(mergePayload([merged]));
      }
      return undefined;
    });

    render(<MobileSearchPage />);
    expect(await screen.findByText(/병합에 실패했습니다/u)).toBeTruthy();
    expect(
      window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => {
      expect(
        window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      ).toBeNull();
    });
    const mergeBodies = fetchMock.mock.calls
      .filter(([input]) => input.toString() === "/api/user-data/merge")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(mergeBodies).toHaveLength(2);
    expect(mergeBodies[1].merge_id).toBe(mergeBodies[0].merge_id);
  });

  it("starts a new merge attempt when local history changes after a merge 401", async () => {
    seedLocalHistory([
      {
        query: "Original Local",
        normalized_query: "originallocal",
        searched_at: "2026-07-20T01:00:00.000Z"
      }
    ]);
    const original = serverHistoryItem(
      "Original Local",
      "originallocal",
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "2026-07-20T01:00:00.000Z"
    );
    const added = serverHistoryItem(
      "New Local",
      "newlocal",
      "cccccccc-cccc-4ccc-bccc-cccccccccccc",
      "2026-07-20T02:00:00.000Z"
    );
    const mergeBodies: Array<{
      merge_id: string;
      recent_searches: Array<{ query: string; searched_at: string }>;
    }> = [];
    const fetchMock = authenticatedFetch(({ url, init }) => {
      if (url === "/api/user-data/merge") {
        mergeBodies.push(JSON.parse(String(init?.body)));
        return mergeBodies.length === 1
          ? errorJsonResponse(401, "UNAUTHENTICATED")
          : jsonResponse(mergePayload([added, original]));
      }
      if (url.startsWith("/api/search?")) {
        return jsonResponse({
          ...searchResponse,
          query: "New Local",
          normalized_query: "newlocal"
        });
      }
      return undefined;
    });

    render(<MobileSearchPage />);
    expect(
      await screen.findByText(/로그인 세션이 만료되어 최근 검색어를 동기화/u)
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "New Local" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    await waitFor(() => {
      expect(
        readStoredHistoryPayload().items.map(({ query }) => query)
      ).toEqual(["New Local", "Original Local"]);
    });
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await screen.findByRole("button", { name: "New Local" });
    await waitFor(() => {
      expect(
        window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      ).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(mergeBodies).toHaveLength(2);
    expect(mergeBodies[1].recent_searches.map(({ query }) => query)).toEqual([
      "New Local",
      "Original Local"
    ]);
    expect(mergeBodies[1].merge_id).not.toBe(mergeBodies[0].merge_id);
  });

  it("deletes individual and all guest history locally without triggering search", async () => {
    seedLocalHistory([
      {
        query: "Newest",
        normalized_query: "newest",
        searched_at: "2026-07-20T02:00:00.000Z"
      },
      {
        query: "Older",
        normalized_query: "older",
        searched_at: "2026-07-20T01:00:00.000Z"
      }
    ]);
    const fetchMock = mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);
    await screen.findByRole("button", { name: "Newest" });
    fireEvent.click(
      screen.getByRole("button", { name: "최근 검색어 Newest 삭제" })
    );
    expect(screen.queryByRole("button", { name: "Newest" })).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        input.toString().startsWith("/api/search?")
      )
    ).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "최근 검색어 전체 삭제" })
    );
    expect(await screen.findByText("최근 검색어가 없습니다.")).toBeTruthy();
    expect(window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("restores exact authenticated history order when an individual delete fails", async () => {
    const newest = serverHistoryItem(
      "Newest",
      "newest",
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "2026-07-20T02:00:00.000Z"
    );
    const older = serverHistoryItem(
      "Older",
      "older",
      "cccccccc-cccc-4ccc-bccc-cccccccccccc",
      "2026-07-20T01:00:00.000Z"
    );
    authenticatedFetch(({ url, init }) => {
      if (url === "/api/search-history") {
        return jsonResponse({ items: [newest, older] });
      }
      if (
        url === `/api/search-history/${newest.id}` &&
        init?.method === "DELETE"
      ) {
        return errorJsonResponse(500, "PERSONALIZATION_UNAVAILABLE");
      }
      return undefined;
    });

    const { container } = render(<MobileSearchPage />);
    await screen.findByRole("button", { name: "Newest" });
    fireEvent.click(
      screen.getByRole("button", { name: "최근 검색어 Newest 삭제" })
    );

    expect(
      await screen.findByText(/이전 목록과 순서로 복구했습니다/u)
    ).toBeTruthy();
    const queries = [...container.querySelectorAll(".recent-search-query")].map(
      (element) => element.textContent
    );
    expect(queries).toEqual(["Newest", "Older"]);
  });

  it("uses server authority for authenticated individual and full deletion", async () => {
    const first = serverHistoryItem(
      "First",
      "first",
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "2026-07-20T02:00:00.000Z"
    );
    const second = serverHistoryItem(
      "Second",
      "second",
      "cccccccc-cccc-4ccc-bccc-cccccccccccc",
      "2026-07-20T01:00:00.000Z"
    );
    const fetchMock = authenticatedFetch(({ url, init }) => {
      if (url === "/api/search-history" && init?.method === "DELETE") {
        return jsonResponse({ deleted_count: 1 });
      }
      if (url === "/api/search-history") {
        return jsonResponse({ items: [first, second] });
      }
      if (url === `/api/search-history/${first.id}`) {
        return jsonResponse({ deleted_count: 1 });
      }
      return undefined;
    });

    render(<MobileSearchPage />);
    await screen.findByRole("button", { name: "First" });
    fireEvent.click(
      screen.getByRole("button", { name: "최근 검색어 First 삭제" })
    );
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "First" })).toBeNull();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "최근 검색어 전체 삭제" })
    );
    expect(await screen.findByText("최근 검색어가 없습니다.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search-history",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("records a search after an in-flight clear finishes", async () => {
    const existing = serverHistoryItem(
      "Existing",
      "existing",
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "2026-07-20T01:00:00.000Z"
    );
    const recorded = serverHistoryItem(
      "After Clear",
      "afterclear",
      "cccccccc-cccc-4ccc-bccc-cccccccccccc",
      "2026-07-20T02:00:00.000Z"
    );
    const clearRequest = deferred<Response>();
    let postCount = 0;
    authenticatedFetch(({ url, init }) => {
      if (url === "/api/search-history" && init?.method === "DELETE") {
        return clearRequest.promise;
      }
      if (url === "/api/search-history" && init?.method === "POST") {
        postCount += 1;
        return jsonResponse({ item: recorded });
      }
      if (url === "/api/search-history") {
        return jsonResponse({ items: [existing] });
      }
      if (url.startsWith("/api/search?")) {
        return jsonResponse({
          ...searchResponse,
          query: "After Clear",
          normalized_query: "afterclear"
        });
      }
      return undefined;
    });

    render(<MobileSearchPage />);
    await screen.findByRole("button", { name: "Existing" });
    fireEvent.click(
      screen.getByRole("button", { name: "최근 검색어 전체 삭제" })
    );
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "After Clear" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    await act(async () => Promise.resolve());
    expect(postCount).toBe(0);
    clearRequest.resolve(jsonResponse({ deleted_count: 1 }));

    expect(
      await screen.findByRole("button", { name: "After Clear" })
    ).toBeTruthy();
    expect(postCount).toBe(1);
  });

  it("runs an explicit search when a recent query is selected", async () => {
    seedLocalHistory([
      {
        query: "Recent Choice",
        normalized_query: "recentchoice",
        searched_at: "2026-07-20T01:00:00.000Z"
      }
    ]);
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      {
        ok: true,
        body: {
          ...searchResponse,
          query: "Recent Choice",
          normalized_query: "recentchoice"
        }
      }
    ]);

    render(<MobileSearchPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Recent Choice" })
    );

    await screen.findByText("Sample Display Title");
    expect((screen.getByLabelText("검색어") as HTMLInputElement).value).toBe(
      "Recent Choice"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search?q=Recent+Choice&provider_id=provider_default",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("finishes initial history loading before recording a newer search", async () => {
    const initialHistoryRequest = deferred<Response>();
    const recorded = serverHistoryItem(
      "Queued Search",
      "queuedsearch",
      "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "2026-07-20T02:00:00.000Z"
    );
    let postCount = 0;
    const fetchMock = authenticatedFetch(({ url, init }) => {
      if (url === "/api/search-history" && init?.method === "POST") {
        postCount += 1;
        return jsonResponse({ item: recorded });
      }
      if (url === "/api/search-history") {
        return initialHistoryRequest.promise;
      }
      if (url.startsWith("/api/search?")) {
        return jsonResponse({
          ...searchResponse,
          query: "Queued Search",
          normalized_query: "queuedsearch"
        });
      }
      return undefined;
    });

    render(<MobileSearchPage />);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            input.toString() === "/api/search-history" &&
            init?.method === undefined
        )
      ).toHaveLength(1);
    });
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "Queued Search" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");
    await act(async () => Promise.resolve());
    expect(postCount).toBe(0);
    initialHistoryRequest.resolve(jsonResponse({ items: [] }));

    expect(
      await screen.findByRole("button", { name: "Queued Search" })
    ).toBeTruthy();
    expect(postCount).toBe(1);
  });

  it("serializes rapid authenticated history writes so older responses cannot win", async () => {
    const firstPost = deferred<Response>();
    let postCount = 0;
    const fetchMock = authenticatedFetch(({ url, init }) => {
      if (url === "/api/search-history" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? firstPost.promise
          : jsonResponse({
              item: serverHistoryItem(
                "second",
                "second",
                "cccccccc-cccc-4ccc-bccc-cccccccccccc",
                "2026-07-20T02:00:00.000Z"
              )
            });
      }
      if (url === "/api/search-history") {
        return jsonResponse({ items: [] });
      }
      if (url.startsWith("/api/search?q=first")) {
        return jsonResponse({
          ...searchResponse,
          query: "first",
          normalized_query: "first"
        });
      }
      if (url.startsWith("/api/search?q=second")) {
        return jsonResponse({
          ...searchResponse,
          query: "second",
          normalized_query: "second"
        });
      }
      return undefined;
    });

    const { container } = render(<MobileSearchPage />);
    await screen.findByText("최근 검색어가 없습니다.");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "first" }
    });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(postCount).toBe(1));
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "second" }
    });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            input.toString() === "/api/search-history" &&
            init?.method === "POST"
        )
      ).toHaveLength(1);
    });

    firstPost.resolve(
      jsonResponse({
        item: serverHistoryItem(
          "first",
          "first",
          "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
          "2026-07-20T01:00:00.000Z"
        )
      })
    );
    await waitFor(() => {
      const queries = [
        ...container.querySelectorAll(".recent-search-query")
      ].map((element) => element.textContent);
      expect(queries).toEqual(["second", "first"]);
    });
  });
});

type StoredHistoryTestItem = {
  query: string;
  normalized_query: string;
  searched_at: string;
};

function authenticatedFetch(
  resolve: (context: {
    url: string;
    init: RequestInit | undefined;
  }) => Response | Promise<Response> | undefined
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return jsonResponse({ user: { id: "authenticated-user" } });
      }
      if (url === "/api/providers") {
        return jsonResponse({ items: providers });
      }
      if (url === "/api/user-preference") {
        return unauthenticatedResponse();
      }
      if (url.startsWith("/api/favorites?")) {
        return jsonResponse({ items: [], next_cursor: null });
      }

      const response = resolve({ url, init });
      if (response !== undefined) {
        return response;
      }
      throw new Error(`Unexpected fetch call: ${url} (${init?.method})`);
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function serverHistoryItem(
  query: string,
  normalized_query: string,
  id: string,
  searched_at: string
) {
  return { id, query, normalized_query, searched_at };
}

function mergePayload(recentSearches: ReturnType<typeof serverHistoryItem>[]) {
  return {
    merged: true,
    recent_searches: recentSearches,
    default_provider: { default_provider: null, source: "none" }
  };
}

function seedLocalHistory(items: StoredHistoryTestItem[]): void {
  window.localStorage.setItem(
    SEARCH_HISTORY_STORAGE_KEY,
    JSON.stringify({ version: 1, items })
  );
}

function readStoredHistoryPayload(): {
  version: number;
  items: StoredHistoryTestItem[];
} {
  return JSON.parse(
    window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? "null"
  );
}

function mockFetch(
  responses: Array<{ ok: boolean; status?: number; body: unknown }>
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (input.toString() === "/api/auth/get-session") {
      return jsonResponse(null);
    }

    if (input.toString() === "/api/user-preference") {
      return unauthenticatedResponse();
    }

    const response = responses.shift();

    if (response === undefined) {
      throw new Error("Unexpected fetch call.");
    }

    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body
    } as Response;
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function mockFetchWithPreference(
  responses: Array<{ ok: boolean; status?: number; body: unknown }>,
  preference: {
    get: { ok: boolean; status?: number; body: unknown };
    put?: { ok: boolean; status?: number; body: unknown };
  }
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return jsonResponse(null);
      }

      if (url === "/api/user-preference") {
        return queuedResponse(preference.get);
      }

      if (url === "/api/user-preference/default-provider") {
        expect(init?.method).toBe("PUT");
        return queuedResponse(
          preference.put ?? { ok: false, status: 500, body: {} }
        );
      }

      const response = responses.shift();
      if (response === undefined) {
        throw new Error(`Unexpected fetch call: ${url}`);
      }

      return queuedResponse(response);
    }
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function queuedResponse(response: {
  ok: boolean;
  status?: number;
  body: unknown;
}): Response {
  return {
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body
  } as Response;
}

function errorJsonResponse(status: number, code: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message: "safe" } })
  } as Response;
}

function unauthenticatedResponse(): Response {
  return {
    ok: false,
    status: 401,
    json: async () => ({
      error: { code: "UNAUTHENTICATED", message: "Authentication is required." }
    })
  } as Response;
}

function preferencePayload(
  providerId: string,
  source: "user" | "operational_default"
) {
  return {
    default_provider: providers.find(({ id }) => id === providerId) ?? null,
    source
  };
}

function searchResponseWithSong({
  displayTitle,
  id
}: {
  displayTitle: string;
  id: string;
}) {
  return {
    ...searchResponse,
    items: [
      {
        ...searchResponse.items[0],
        song: {
          ...searchResponse.items[0].song,
          display_title: displayTitle,
          id
        }
      }
    ]
  };
}

function searchResponseWithEntries(
  entries: (typeof searchResponse.items)[number]["karaoke_entries"]
) {
  return {
    ...searchResponse,
    items: [
      {
        ...searchResponse.items[0],
        karaoke_entries: entries
      }
    ]
  };
}
