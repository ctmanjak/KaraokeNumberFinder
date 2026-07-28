import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import { Client } from "pg";

import { E2E_FIXTURE_MARKER } from "../lib/e2e/constants";
import { expect, mutationHeaders, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

test("administrator creates once, then branches to exact and possible existing-song candidates", async ({
  page,
  users
}) => {
  const database = await connectTestDatabase();
  const suffix = randomUUID();
  const identity = {
    canonicalTitle: `T04 Canonical ${suffix}`,
    displayTitle: `T04 표시 ${suffix}`,
    artist: `T04 Artist ${suffix}`,
    karaokeNumber: `T04${suffix.replaceAll("-", "").slice(0, 12)}`
  };
  const admin = users.create("admin-song-create");

  try {
    await users.loginAdmin(page.request, admin);
    await page.goto("/admin/songs/new");
    await fillCreateForm(page, identity);

    let createRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/admin/songs"
      ) {
        createRequests += 1;
      }
    });

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/admin/songs"
    );
    await page.getByRole("button", { name: "노래 추가" }).dblclick();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    await expect(page).not.toHaveURL(/\/admin\/songs\/new$/u);
    await expect(
      page.getByRole("heading", { name: identity.displayTitle })
    ).toBeVisible();
    expect(createRequests).toBe(1);
    const createdPath = new URL(page.url()).pathname;

    await page.goto("/admin/songs/new");
    await fillIdentity(page, identity);
    await expect(
      page.getByRole("heading", { name: "동일 곡이 이미 있습니다" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "노래 추가" })
    ).toBeDisabled();

    const existingLink = page.getByRole("link", {
      name: `${identity.displayTitle} 기존 곡 열기 (새 탭)`
    });
    await expect(existingLink).toHaveAttribute("target", "_blank");
    await expect(existingLink).toHaveAttribute("rel", "noopener");
    const popupPromise = page.waitForEvent("popup");
    await existingLink.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(new RegExp(`${escapeRegExp(createdPath)}$`));
    await popup.close();
    await expect(page.getByLabel("원제")).toHaveValue(identity.canonicalTitle);
    await expect(page.getByLabel("표시 제목")).toHaveValue(
      identity.displayTitle
    );
    await expect(page.getByLabel("가수")).toHaveValue(identity.artist);

    await page.getByLabel("원제").fill(identity.displayTitle);
    await expect(
      page.getByRole("heading", { name: "중복 가능 후보" })
    ).toBeVisible();
    const acknowledgement = page.getByLabel(
      "표시된 후보를 모두 확인했으며 새 곡 추가"
    );
    await acknowledgement.check();
    await expect(page.getByRole("button", { name: "노래 추가" })).toBeEnabled();

    await page.getByLabel("원제").fill(`${identity.displayTitle} 변형`);
    await expect(
      page.getByRole("heading", { name: "중복 가능 후보" })
    ).toBeVisible();
    await expect(
      page.getByLabel("표시된 후보를 모두 확인했으며 새 곡 추가")
    ).not.toBeChecked();
  } finally {
    await deleteSongsByIdentity(database, identity);
    await database.end();
  }
});

test("ambiguous create response performs a duplicate recheck without replaying POST", async ({
  page,
  users
}) => {
  const database = await connectTestDatabase();
  const suffix = randomUUID();
  const identity = {
    canonicalTitle: `T04 Ambiguous ${suffix}`,
    displayTitle: `T04 불명확 ${suffix}`,
    artist: `T04 Recovery Artist ${suffix}`,
    karaokeNumber: `T04${suffix.replaceAll("-", "").slice(0, 12)}`
  };
  const admin = users.create("admin-song-ambiguous");
  let createRequests = 0;

  try {
    await users.loginAdmin(page.request, admin);
    await page.goto("/admin/songs/new");
    await fillCreateForm(page, identity);
    const providerId = await page
      .locator(".admin-repeat-card select.provider-select")
      .first()
      .inputValue();
    const verifiedDate = new Date().toISOString().slice(0, 10);
    const committedResponse = await page.request.post("/api/admin/songs", {
      headers: mutationHeaders(),
      data: {
        original_language: "ja",
        canonical_title: identity.canonicalTitle,
        display_title: identity.displayTitle,
        canonical_artist: identity.artist,
        release_year: null,
        tie_in: null,
        source_name: E2E_FIXTURE_MARKER,
        source_url: null,
        aliases: [],
        karaoke_entries: [
          {
            provider_id: providerId,
            karaoke_number: identity.karaokeNumber,
            version_info: "",
            availability_status: "available",
            last_verified_at: verifiedDate,
            source_name: E2E_FIXTURE_MARKER,
            source_url: null,
            verification_note: null
          }
        ]
      }
    });
    expect(committedResponse.status()).toBe(201);

    await page.route("**/api/admin/songs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      createRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "DUPLICATE_CHECK_UNAVAILABLE",
            message: "Duplicate checking is temporarily unavailable."
          }
        })
      });
    });

    await page.getByRole("button", { name: "노래 추가" }).click();

    await expect(
      page.getByText(
        "곡이 발견되었지만 방금 요청의 성공 여부는 확정할 수 없습니다. 기존 곡을 확인해 주세요."
      )
    ).toBeVisible();
    expect(createRequests).toBe(1);
    await expect(page).toHaveURL(/\/admin\/songs\/new$/u);
    await expect(
      page.getByRole("link", {
        name: `${identity.displayTitle} 기존 곡 열기 (새 탭)`
      })
    ).toBeVisible();
  } finally {
    if (!page.isClosed()) {
      await page.unrouteAll({ behavior: "wait" });
    }
    await deleteSongsByIdentity(database, identity);
    await database.end();
  }
});

async function fillCreateForm(
  page: Page,
  identity: Parameters<typeof fillIdentity>[1]
) {
  await fillIdentity(page, identity);
  await expect(page.getByText("중복 후보가 없습니다.")).toBeVisible();
  await page.getByLabel("출처명", { exact: true }).fill(E2E_FIXTURE_MARKER);
  await page.getByLabel("예약 번호").fill(identity.karaokeNumber);
  await page
    .getByLabel("마지막 확인일")
    .fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("제공사 출처명").fill(E2E_FIXTURE_MARKER);
}

async function fillIdentity(
  page: Page,
  identity: {
    canonicalTitle: string;
    displayTitle: string;
    artist: string;
    karaokeNumber: string;
  }
) {
  await page.getByLabel("원제").fill(identity.canonicalTitle);
  await page.getByLabel("표시 제목").fill(identity.displayTitle);
  await page.getByLabel("가수").fill(identity.artist);
}

async function connectTestDatabase(): Promise<Client> {
  const databaseUrl = process.env.M3_TEST_DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error("M3_TEST_DATABASE_URL is required for ADMIN-T04 E2E.");
  }
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  return database;
}

async function deleteSongsByIdentity(
  database: Client,
  identity: {
    canonicalTitle: string;
    artist: string;
  }
) {
  await database.query(
    "DELETE FROM songs WHERE canonical_title = $1 AND canonical_artist = $2",
    [identity.canonicalTitle, identity.artist]
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
