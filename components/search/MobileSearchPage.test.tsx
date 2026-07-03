// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads providers and selects the default provider", async () => {
    mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");

    expect((select as HTMLSelectElement).value).toBe("provider_default");
  });

  it("falls back to the first active provider when no default exists", async () => {
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

    expect((select as HTMLSelectElement).value).toBe("provider_secondary");
  });

  it("does not call search API before submit or while typing", async () => {
    const fetchMock = mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/providers");
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
      "/api/search?q=sample+title&provider_id=provider_default"
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
      "/api/search?q=sample+title&provider_id=provider_default"
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes the selected provider_id in search requests", async () => {
    const fetchMock = mockFetch([
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

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=sample+title&provider_id=provider_secondary"
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

  it("ignores stale search responses when requests resolve out of order", async () => {
    const slowSearch = deferred<Response>();
    const fastSearch = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();

      if (url === "/api/providers") {
        return Promise.resolve(jsonResponse({ items: providers }));
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
      "/api/search?q=second&provider_id=provider_default"
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
      "/api/search?q=retry+query&provider_id=provider_secondary"
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
      "/api/search?q=Suggestion+One&provider_id=provider_default"
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

    expect(fetchMock).toHaveBeenLastCalledWith("/api/search?q=sample+title");
  });
});

function mockFetch(
  responses: Array<{ ok: boolean; status?: number; body: unknown }>
) {
  const fetchMock = vi.fn(async () => {
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
