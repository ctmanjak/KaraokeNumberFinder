import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { E2E_FIXTURE_MARKER } from "../lib/e2e/constants";
import { buildAliasSearchFields } from "../lib/search/normalize";
import { controlHeaders, expect, test, type E2ECatalog } from "./fixtures";

test("administrator edits one aggregate, preserves ids, and explicitly reloads after stale conflict", async ({
  page,
  catalog,
  users
}) => {
  const databaseUrl = process.env.M3_TEST_DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error("M3_TEST_DATABASE_URL is required for admin detail E2E.");
  }
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  const songId = `e2e_admin_t03_${randomUUID()}`;
  const providerId = catalog.providers[0].id;
  const admin = users.create("admin-song-detail");

  try {
    await createSongFixture(database, songId, providerId);
    const catalogResponse = await page.request.get("/api/e2e/control", {
      headers: controlHeaders()
    });
    expect(catalogResponse.status()).toBe(200);
    const publicCatalog = (await catalogResponse.json()) as E2ECatalog;
    expect(publicCatalog.songs.map(({ id }) => id)).not.toContain(songId);

    await users.loginAdmin(page.request, admin);
    await page.goto(`/admin/songs/${encodeURIComponent(songId)}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "E2E 관리자 상세" })
    ).toBeVisible();
    await expect(page.getByLabel("canonical_title")).toHaveAttribute(
      "readonly",
      ""
    );
    await expect(page.getByLabel("display_title")).toHaveAttribute(
      "readonly",
      ""
    );
    await expect(page.getByLabel("artist")).toHaveAttribute("readonly", "");
    await expect(page.getByText("수록 행 1 · 삭제 불가")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "수록 정보 삭제" })
    ).toHaveCount(0);

    await page.getByLabel("발매 연도").fill("2026");
    await page.getByLabel("별칭", { exact: true }).fill("E2E updated alias");
    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/admin/songs/${songId}` &&
        response.request().method() === "PATCH"
    );
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByText("변경사항을 저장했습니다.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "공개 검색에서 확인" })
    ).toHaveAttribute(
      "href",
      "/?q=E2E%20%EA%B4%80%EB%A6%AC%EC%9E%90%20%EC%83%81%EC%84%B8"
    );

    const detailResponse = await page.request.get(
      `/api/admin/songs/${encodeURIComponent(songId)}`
    );
    expect(detailResponse.status()).toBe(200);
    const detail = (await detailResponse.json()) as {
      aliases: Array<{ id: string; alias: string }>;
      karaoke_entries: Array<{ id: string }>;
      system_aliases: Array<{ id: string }>;
    };
    expect(detail.aliases).toContainEqual({
      id: `${songId}_admin_alias`,
      alias: "E2E updated alias",
      language: "en",
      alias_type: "english_title",
      source_name: "E2E fixture",
      source_url: null,
      verification_note: null,
      updated_at: expect.any(String)
    });
    expect(detail.karaoke_entries.map(({ id }) => id)).toContain(
      `${songId}_entry`
    );
    expect(detail.system_aliases.map(({ id }) => id).sort()).toEqual(
      [`${songId}_artist`, `${songId}_canonical`, `${songId}_display`].sort()
    );

    await database.query(
      `UPDATE songs
       SET release_year = 2025,
           updated_at = clock_timestamp() + interval '1 second'
       WHERE id = $1`,
      [songId]
    );
    await page.getByLabel("발매 연도").fill("2027");
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(
      page.getByText("다른 관리자가 이 곡을 먼저 수정했습니다.")
    ).toBeVisible();
    await expect(page.getByLabel("발매 연도")).toHaveValue("2027");

    page.once("dialog", async (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "최신 데이터 다시 불러오기" })
      .click();
    await expect(page.getByLabel("발매 연도")).toHaveValue("2025");
  } finally {
    await database.query("DELETE FROM songs WHERE id = $1", [songId]);
    await database.end();
  }
});

test("detail API preserves guest, user, and administrator authorization boundaries", async ({
  page,
  catalog,
  users
}) => {
  const songId = catalog.songs[0].id;
  expect(
    (
      await page.request.get(`/api/admin/songs/${encodeURIComponent(songId)}`)
    ).status()
  ).toBe(401);

  const user = users.create("admin-boundary");
  await users.login(page.request, user);
  expect(
    (
      await page.request.get(`/api/admin/songs/${encodeURIComponent(songId)}`)
    ).status()
  ).toBe(403);

  await users.loginAdmin(page.request, user);
  expect(
    (
      await page.request.get(`/api/admin/songs/${encodeURIComponent(songId)}`)
    ).status()
  ).toBe(200);
});

async function createSongFixture(
  database: Client,
  songId: string,
  providerId: string
) {
  const canonicalTitle = "E2E Admin Detail";
  const displayTitle = "E2E 관리자 상세";
  const canonicalArtist = "E2E Artist";
  await database.query(
    `INSERT INTO songs (
       id, original_language, canonical_title, display_title, canonical_artist,
       normalized_canonical_title, normalized_canonical_artist,
       release_year, source_name, verified_by, created_at, updated_at
     ) VALUES (
       $1, 'en', $2, $3, $4, $5, $6, 2024, 'E2E fixture', $7, now(), now()
     )`,
    [
      songId,
      canonicalTitle,
      displayTitle,
      canonicalArtist,
      buildAliasSearchFields(canonicalTitle).normalizedAlias,
      buildAliasSearchFields(canonicalArtist).normalizedAlias,
      E2E_FIXTURE_MARKER
    ]
  );
  for (const [id, value, type] of [
    [`${songId}_canonical`, canonicalTitle, "canonical_title"],
    [`${songId}_display`, displayTitle, "display_title"],
    [`${songId}_artist`, canonicalArtist, "artist"],
    [`${songId}_admin_alias`, "E2E original alias", "english_title"]
  ] as const) {
    const search = buildAliasSearchFields(value);
    await database.query(
      `INSERT INTO song_aliases (
         id, song_id, alias, language, alias_type, normalized_alias,
         chosung_alias, source_name, verified_by, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'en', $4::alias_type, $5, $6, 'E2E fixture', $7,
         now(), now()
       )`,
      [
        id,
        songId,
        value,
        type,
        search.normalizedAlias,
        search.chosungAlias || null,
        E2E_FIXTURE_MARKER
      ]
    );
  }
  await database.query(
    `INSERT INTO karaoke_entries (
       id, song_id, provider_id, karaoke_number, version_info,
       availability_status, last_verified_at, source_name, verified_by,
       created_at, updated_at
     ) VALUES ($1, $2, $3, '80808', '', 'available', DATE '2026-07-26',
               'E2E fixture', 'e2e', now(), now())`,
    [`${songId}_entry`, songId, providerId]
  );
}
