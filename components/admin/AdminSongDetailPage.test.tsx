// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { AdminSongDetailPage } from "./AdminSongDetailPage";

describe("administrator song detail page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("separates read-only system aliases from editable aliases and non-deletable entries", async () => {
    vi.stubGlobal("fetch", detailFetcher());

    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "레몬" })
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("canonical_title") as HTMLInputElement).readOnly
    ).toBe(true);
    expect(
      (screen.getByLabelText("display_title") as HTMLInputElement).readOnly
    ).toBe(true);
    expect((screen.getByLabelText("artist") as HTMLInputElement).readOnly).toBe(
      true
    );
    expect(screen.getByText("관리자 추가 별칭 (1/30)")).toBeTruthy();
    expect(screen.getByText("제공사 수록 정보 (1/20)")).toBeTruthy();
    expect(screen.getByText("수록 행 1 · 삭제 불가")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "수록 정보 삭제" })).toBeNull();
  });

  it("preserves existing child ids in one atomic PATCH and shows the public-search link", async () => {
    const fetcher = detailFetcher();
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    fireEvent.change(await screen.findByLabelText("발매 연도"), {
      target: { value: "2019" }
    });
    const saveButton = screen.getByRole("button", { name: "변경사항 저장" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    expect(await screen.findByText("변경사항을 저장했습니다.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "공개 검색에서 확인" })
        .getAttribute("href")
    ).toBe("/?q=%EB%A0%88%EB%AA%AC");

    const patchCall = fetcher.mock.calls.find(
      ([input, init]) =>
        input.toString() === "/api/admin/songs/song-a" &&
        init?.method === "PATCH"
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(String(patchCall?.[1]?.body)) as {
      expected_updated_at: string;
      song: { release_year: number };
      aliases: Array<{ id?: string }>;
      karaoke_entries: Array<{ id?: string }>;
      possible_duplicate_acknowledged_song_ids: string[];
    };
    expect(body).toMatchObject({
      expected_updated_at: "2026-07-26T00:00:00.000Z",
      song: { release_year: 2019 },
      aliases: [{ id: "alias-admin-a" }],
      karaoke_entries: [{ id: "entry-a" }],
      possible_duplicate_acknowledged_song_ids: []
    });
  });

  it("debounces identity checks, locks saving, and requires one acknowledgement for all possible candidates", async () => {
    const fetcher = detailFetcher({
      duplicate: {
        classification: "possible",
        candidates: [candidate("song-b"), candidate("song-c")]
      }
    });
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    fireEvent.change(await screen.findByLabelText("원제"), {
      target: { value: "Lemon live" }
    });
    expect(
      (
        screen.getByRole("button", {
          name: "변경사항 저장"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      fetcher.mock.calls.filter(
        ([input]) => input.toString() === "/api/admin/songs/duplicate-check"
      )
    ).toHaveLength(0);

    expect(
      await screen.findByRole(
        "heading",
        { name: "중복 가능 후보" },
        { timeout: 2_000 }
      )
    ).toBeTruthy();
    expect(screen.getByText("후보 song-b")).toBeTruthy();
    expect(screen.getByText("후보 song-c")).toBeTruthy();
    expect(
      fetcher.mock.calls.filter(
        ([input]) => input.toString() === "/api/admin/songs/duplicate-check"
      )
    ).toHaveLength(1);

    const acknowledgement = screen.getByRole("checkbox", {
      name: "표시된 후보를 모두 확인했으며 수정 저장"
    });
    fireEvent.click(acknowledgement);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "변경사항 저장"
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
    expect(
      screen
        .getByRole("link", {
          name: "후보 song-b 기존 곡 열기 (새 탭)"
        })
        .getAttribute("rel")
    ).toBe("noopener");
  });

  it("keeps the local draft on stale-write failure until explicit reload confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.stubGlobal("fetch", detailFetcher({ staleOnPatch: true }));

    renderPage();
    const year = await screen.findByLabelText("발매 연도");
    fireEvent.change(year, { target: { value: "2020" } });
    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

    expect(
      await screen.findByText("다른 관리자가 이 곡을 먼저 수정했습니다.")
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "최신 데이터 다시 불러오기" })
    );
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect((year as HTMLInputElement).value).toBe("2020");
  });

  it("preserves the draft and disables editing when duplicate-check reports feature-off", async () => {
    const fetcher = detailFetcher({ duplicateFeatureOff: true });
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    const title = await screen.findByLabelText("원제");
    fireEvent.change(title, { target: { value: "Feature-off draft" } });

    expect(
      await screen.findByText(
        "관리자 카탈로그가 비활성화되어 입력은 유지되지만 저장할 수 없습니다.",
        {},
        { timeout: 2_000 }
      )
    ).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe("Feature-off draft");
    expect(
      (
        screen.getByRole("group", {
          name: "곡 기본 정보"
        }) as HTMLFieldSetElement
      ).disabled
    ).toBe(true);
    expect(screen.getByRole("link", { name: "공개 검색으로" })).toBeTruthy();
    expect(
      fetcher.mock.calls.filter(
        ([input]) => input.toString() === "/api/admin/songs/duplicate-check"
      )
    ).toHaveLength(1);
  });
});

function renderPage() {
  return render(
    <AuthProvider>
      <AdminSongDetailPage songId="song-a" />
    </AuthProvider>
  );
}

function detailFetcher(
  options: {
    duplicate?: unknown;
    duplicateFeatureOff?: boolean;
    staleOnPatch?: boolean;
  } = {}
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === "/api/auth/get-session") {
      return jsonResponse({
        user: { id: "admin-a", name: "Admin", is_admin: true }
      });
    }
    if (url === "/api/admin/songs/options") {
      return jsonResponse({
        alias_types: ["translated_title", "romanized_title"],
        availability_statuses: [
          "unknown",
          "available",
          "not_available",
          "temporarily_unavailable"
        ],
        providers: [{ id: "tj", name: "TJ", country: "KR" }]
      });
    }
    if (url === "/api/admin/songs/duplicate-check") {
      if (options.duplicateFeatureOff) {
        return jsonResponse(
          {
            error: {
              code: "ADMIN_CATALOG_NOT_ENABLED",
              message: "The administrator catalog is not enabled.",
              request_id: "request-feature-off"
            }
          },
          403
        );
      }
      return jsonResponse(
        options.duplicate ?? { classification: "none", candidates: [] }
      );
    }
    if (url === "/api/admin/songs/song-a" && init?.method === "PATCH") {
      if (options.staleOnPatch) {
        return jsonResponse(
          {
            error: {
              code: "STALE_SONG",
              message: "The song changed.",
              request_id: "request-stale"
            }
          },
          409
        );
      }
      const request = JSON.parse(String(init.body)) as {
        song: { release_year: number | null };
      };
      return jsonResponse({
        detail: {
          ...detail(),
          song: {
            ...detail().song,
            release_year: request.song.release_year,
            updated_at: "2026-07-27T00:00:00.000Z"
          }
        },
        change_counts: {
          song_fields: 1,
          aliases_added: 0,
          aliases_updated: 0,
          aliases_deleted: 0,
          karaoke_entries_added: 0,
          karaoke_entries_updated: 0
        }
      });
    }
    if (url === "/api/admin/songs/song-a") {
      return jsonResponse(detail());
    }
    return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
  });
}

function detail() {
  return {
    song: {
      id: "song-a",
      original_language: "ja",
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "米津玄師",
      release_year: 2018,
      tie_in: null,
      source_name: "Official catalog",
      source_url: "https://example.com/song-a",
      verification_note: null,
      updated_at: "2026-07-26T00:00:00.000Z"
    },
    system_aliases: [
      {
        id: "alias-system-title",
        alias: "Lemon",
        language: "ja",
        alias_type: "canonical_title",
        updated_at: "2026-07-26T00:00:00.000Z"
      },
      {
        id: "alias-system-display",
        alias: "레몬",
        language: "ko",
        alias_type: "display_title",
        updated_at: "2026-07-26T00:00:00.000Z"
      },
      {
        id: "alias-system-artist",
        alias: "米津玄師",
        language: "ja",
        alias_type: "artist",
        updated_at: "2026-07-26T00:00:00.000Z"
      }
    ],
    aliases: [
      {
        id: "alias-admin-a",
        alias: "Lemon OST",
        language: "en",
        alias_type: "translated_title",
        source_name: null,
        source_url: null,
        verification_note: null,
        updated_at: "2026-07-26T00:00:00.000Z"
      }
    ],
    karaoke_entries: [
      {
        id: "entry-a",
        provider_id: "tj",
        provider_name: "TJ",
        provider_country: "KR",
        karaoke_number: "28822",
        version_info: "",
        availability_status: "available",
        last_verified_at: "2026-07-26",
        source_name: "TJ catalog",
        source_url: null,
        verification_note: null,
        updated_at: "2026-07-26T00:00:00.000Z"
      }
    ],
    limits: { aliases: 30, karaoke_entries: 20 }
  };
}

function candidate(id: string) {
  return {
    id,
    display_title: `후보 ${id}`,
    canonical_title: `Candidate ${id}`,
    canonical_artist: "Artist",
    original_language: "en",
    release_year: 2026,
    tie_in: null,
    provider_summary: [],
    match_evidence: [
      {
        role: "title",
        strength: "partial",
        input_field: "canonical_title",
        candidate_field: "song.canonical_title",
        matched_value: `Candidate ${id}`
      }
    ],
    admin_path: `/admin/songs/${id}`
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body
  } as Response;
}
