import type { Route } from "@playwright/test";

import {
  expect,
  loginDirectly,
  mutationHeaders,
  searchFor,
  test
} from "./fixtures";

test("auth 401 keeps the browser in guest mode and public search remains usable", async ({
  page,
  catalog
}) => {
  await page.route(
    "**/api/auth/get-session",
    (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        headers: { "www-authenticate": "Session" },
        body: JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "Login required." }
        })
      }),
    { times: 1 }
  );

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Google 로그인", exact: true })
  ).toBeVisible();
  await searchFor(page, catalog.songs[0]);
});

test("auth timeout leaves public search usable and ignores the late response", async ({
  page,
  catalog
}) => {
  const lateAuth = controlledRoute();
  await page.route("**/api/auth/get-session", lateAuth.handler, { times: 1 });

  await page.goto("/");
  await lateAuth.requestSeen;
  await expect(
    page.getByText(
      "인증 시스템에 연결할 수 없지만 검색은 계속 사용할 수 있습니다."
    )
  ).toBeVisible({ timeout: 8_000 });
  await searchFor(page, catalog.songs[0]);
  lateAuth.release(200, null);
  await lateAuth.settled;
  await expect(
    page.getByRole("heading", { name: catalog.songs[0].display_title }).first()
  ).toBeVisible();
});

test("favorite add rolls back on 5xx and moves to reauthentication on 401 without losing search", async ({
  page,
  catalog,
  users
}) => {
  const user = users.create("favorite-errors");
  await loginDirectly(page, users, user);
  await page.goto("/");
  await searchFor(page, catalog.songs[0]);

  const favoriteURL = `**/api/favorites/${catalog.songs[0].id}`;
  const serverFailure = controlledRoute();
  await page.route(favoriteURL, serverFailure.handler);
  await page
    .getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에 추가`
    })
    .click();
  await serverFailure.requestSeen;
  await expect(
    page.getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에서 제거`
    })
  ).toHaveAttribute("aria-pressed", "true");
  serverFailure.release(503, {
    error: { code: "PERSONALIZATION_UNAVAILABLE", message: "Unavailable." }
  });
  await serverFailure.settled;
  await expect(
    page.getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에 추가`
    })
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByText(
      "즐겨찾기 변경에 실패해 이전 상태로 되돌렸습니다. 검색 결과는 유지됩니다."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: catalog.songs[0].display_title }).first()
  ).toBeVisible();

  await page.unroute(favoriteURL);
  await page.route(
    favoriteURL,
    (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        headers: { "www-authenticate": "Session" },
        body: JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "Login required." }
        })
      }),
    { times: 1 }
  );
  await page
    .getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에 추가`
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "세션이 만료되었습니다" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: catalog.songs[0].display_title }).first()
  ).toBeVisible();
});

test("favorite timeout rolls optimistic UI back while public results remain", async ({
  page,
  catalog,
  users
}) => {
  const user = users.create("favorite-timeout");
  await loginDirectly(page, users, user);
  await page.goto("/");
  await searchFor(page, catalog.songs[0]);

  const timeout = controlledRoute();
  await page.route(`**/api/favorites/${catalog.songs[0].id}`, timeout.handler);
  await page
    .getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에 추가`
    })
    .click();
  await timeout.requestSeen;
  await expect(
    page.getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에서 제거`
    })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText(
      "즐겨찾기 변경에 실패해 이전 상태로 되돌렸습니다. 검색 결과는 유지됩니다."
    )
  ).toBeVisible({ timeout: 8_000 });
  timeout.release(503, {
    error: { code: "PERSONALIZATION_UNAVAILABLE", message: "Late response." }
  });
  await timeout.settled;
  await expect(
    page.getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에 추가`
    })
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("heading", { name: catalog.songs[0].display_title }).first()
  ).toBeVisible();
});

test("failed favorite deletion restores the original browser-visible order", async ({
  page,
  catalog,
  users
}) => {
  const user = users.create("favorite-delete");
  await loginDirectly(page, users, user);
  for (const song of catalog.songs.slice(0, 2)) {
    const response = await page.request.put(
      `/api/favorites/${encodeURIComponent(song.id)}`,
      { headers: mutationHeaders() }
    );
    expect(response.status()).toBe(200);
  }

  await page.goto("/favorites");
  const list = page.getByRole("list", { name: "즐겨찾기 목록" });
  await expect(list).toBeVisible();
  const originalOrder = await list.getByRole("heading").allTextContents();
  expect(originalOrder.length >= 2).toBe(true);
  const target = catalog.songs.find(
    ({ display_title }) => display_title === originalOrder[0]
  );
  expect(target !== undefined).toBe(true);

  const deletion = controlledRoute();
  await page.route(
    `**/api/favorites/${target?.id ?? "missing"}`,
    deletion.handler
  );
  await page
    .getByRole("button", {
      name: `${target?.display_title ?? "missing"} 즐겨찾기에서 제거`
    })
    .click();
  await deletion.requestSeen;
  await expect(
    page.getByRole("heading", { name: target?.display_title ?? "missing" })
  ).toHaveCount(0);
  deletion.release(503, {
    error: { code: "PERSONALIZATION_UNAVAILABLE", message: "Unavailable." }
  });
  await deletion.settled;
  await expect(
    page.getByText("삭제에 실패해 항목과 순서를 복구했습니다.")
  ).toBeVisible();
  await expect
    .poll(() => list.getByRole("heading").allTextContents())
    .toEqual(originalOrder);
});

test("auth and merge failures remain isolated from search, then merge retry succeeds", async ({
  page,
  catalog,
  users
}) => {
  await page.route(
    "**/api/auth/get-session",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "AUTH_UNAVAILABLE", message: "Unavailable." }
        })
      }),
    { times: 1 }
  );
  await page.goto("/");
  await expect(
    page.getByText(
      "인증 시스템에 연결할 수 없지만 검색은 계속 사용할 수 있습니다."
    )
  ).toBeVisible();
  await searchFor(page, catalog.songs[0]);

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Google 로그인", exact: true })
  ).toBeVisible();
  await searchFor(page, catalog.songs[0]);
  const user = users.create("merge-retry");
  const mergeFailure = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/user-data/merge" &&
      response.status() === 503
  );
  await page.route(
    "**/api/user-data/merge",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "PERSONALIZATION_UNAVAILABLE",
            message: "Unavailable."
          }
        })
      }),
    { times: 1 }
  );
  await loginDirectly(page, users, user);
  await page.reload();
  await mergeFailure;
  const recentSection = page.getByRole("region", { name: "최근 검색어" });
  await expect(
    recentSection.getByText(
      "최근 검색어 병합에 실패했습니다. 로컬 기록은 유지되며 다시 시도할 수 있습니다."
    )
  ).toBeVisible();
  await searchFor(page, catalog.songs[1]);
  const retryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/user-data/merge" &&
      response.status() === 200
  );
  await recentSection.getByRole("button", { name: "다시 시도" }).click();
  await retryResponse;
  await expect(
    recentSection.getByRole("button", {
      name: catalog.songs[0].query,
      exact: true
    })
  ).toBeVisible();
  await expect(
    recentSection.getByRole("button", {
      name: catalog.songs[0].query,
      exact: true
    })
  ).toHaveCount(1);
  await expect(
    recentSection.getByRole("button", {
      name: catalog.songs[1].query,
      exact: true
    })
  ).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("knf:v1:recent-searches"))
    )
    .toBeNull();
});

test("a slow provider write cannot overwrite the latest browser selection", async ({
  page,
  catalog,
  users
}) => {
  const user = users.create("provider-race");
  await loginDirectly(page, users, user);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: `${user.name} 사용자 메뉴` })
  ).toBeVisible();

  const select = page.getByLabel("제공사");
  const initialProviderId = await select.inputValue();
  const firstProvider = catalog.providers.find(
    ({ id }) => id !== initialProviderId
  );
  expect(firstProvider !== undefined).toBe(true);

  const firstWrite = controlledRoute();
  await page.route(
    "**/api/user-preference/default-provider",
    firstWrite.handler,
    { times: 1 }
  );
  await select.selectOption(firstProvider?.id ?? "");
  await expect(select).toHaveValue(firstProvider?.id ?? "");
  await firstWrite.requestSeen;

  const committedFirstWrite = await page.request.put(
    "/api/user-preference/default-provider",
    {
      headers: mutationHeaders(),
      data: { provider_id: firstProvider?.id }
    }
  );
  expect(committedFirstWrite.status()).toBe(200);
  const firstWritePayload = await committedFirstWrite.json();

  await select.selectOption(initialProviderId);
  await expect(select).toHaveValue(initialProviderId);
  firstWrite.release(200, firstWritePayload);
  await firstWrite.settled;

  await expect
    .poll(async () => {
      const response = await page.request.get("/api/user-preference");
      return (
        (await response.json()) as {
          default_provider: { id: string } | null;
        }
      ).default_provider?.id;
    })
    .toBe(initialProviderId);
  await page.reload();
  await expect(select).toHaveValue(initialProviderId);
});

test("out-of-order search responses cannot replace the latest visible result", async ({
  page,
  catalog
}) => {
  await page.goto("/");
  await searchFor(page, catalog.songs[0]);
  await searchFor(page, catalog.songs[1]);

  const firstPayload = await searchPayload(page, catalog.songs[0].query);
  const secondPayload = await searchPayload(page, catalog.songs[1].query);
  const first = controlledRoute();
  await page.route("**/api/search?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === catalog.songs[0].query) {
      await first.handler(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(secondPayload)
    });
  });

  await page
    .getByRole("button", { name: catalog.songs[0].query, exact: true })
    .click();
  await first.requestSeen;
  await page
    .getByRole("button", { name: catalog.songs[1].query, exact: true })
    .click();
  await expect(page.locator(".results-summary")).toContainText(
    catalog.songs[1].query
  );
  first.release(200, firstPayload);
  await first.settled;
  await expect(page.locator(".results-summary")).toContainText(
    catalog.songs[1].query
  );
});

test("late personalization response after logout cannot restore the previous user UI", async ({
  page,
  catalog,
  users
}) => {
  const user = users.create("late-logout");
  await loginDirectly(page, users, user);
  expect(
    (
      await page.request.put(
        `/api/favorites/${encodeURIComponent(catalog.songs[0].id)}`,
        { headers: mutationHeaders() }
      )
    ).status()
  ).toBe(200);
  const favoritePayload = await page.request.get("/api/favorites");
  expect(favoritePayload.status()).toBe(200);
  const late = controlledRoute();
  await page.route("**/api/favorites?*", late.handler);

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: `${user.name} 사용자 메뉴` })
  ).toBeVisible();
  await late.requestSeen;
  await searchFor(page, catalog.songs[0]);
  await page.getByRole("button", { name: `${user.name} 사용자 메뉴` }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Google 로그인", exact: true })
  ).toBeVisible();

  late.release(200, await favoritePayload.json());
  await late.settled;
  await expect(
    page.getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에 추가`
    })
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: `${user.name} 사용자 메뉴` })
  ).toHaveCount(0);
});

test("late response from the previous user cannot overwrite a switched account", async ({
  page,
  catalog,
  users
}) => {
  const userA = users.create("late-switch-a");
  const userB = users.create("late-switch-b");

  await loginDirectly(page, users, userA);
  expect(
    (
      await page.request.put(
        `/api/favorites/${encodeURIComponent(catalog.songs[0].id)}`,
        { headers: mutationHeaders() }
      )
    ).status()
  ).toBe(200);
  const previousUserPayload = await page.request.get("/api/favorites");
  expect(previousUserPayload.status()).toBe(200);

  await loginDirectly(page, users, userB);
  expect(
    (
      await page.request.put(
        `/api/favorites/${encodeURIComponent(catalog.songs[1].id)}`,
        { headers: mutationHeaders() }
      )
    ).status()
  ).toBe(200);
  await loginDirectly(page, users, userA);

  const late = controlledRoute();
  await page.route("**/api/favorites?*", late.handler, { times: 1 });
  await page.goto("/");
  await late.requestSeen;

  await users.login(page.request, userB);
  await page.reload();
  await expect(
    page.getByRole("button", { name: `${userB.name} 사용자 메뉴` })
  ).toBeVisible();
  await searchFor(page, catalog.songs[1]);
  const currentUserFavorite = page.getByRole("button", {
    name: `${catalog.songs[1].display_title} 즐겨찾기에서 제거`
  });
  await expect(currentUserFavorite).toHaveAttribute("aria-pressed", "true");

  late.release(200, await previousUserPayload.json());
  await late.settled;
  await expect(currentUserFavorite).toHaveAttribute("aria-pressed", "true");
  await searchFor(page, catalog.songs[0]);
  await expect(
    page.getByRole("button", {
      name: `${catalog.songs[0].display_title} 즐겨찾기에 추가`
    })
  ).toHaveAttribute("aria-pressed", "false");
});

function controlledRoute(): {
  handler: (route: Route) => Promise<void>;
  requestSeen: Promise<void>;
  release: (status: number, body: unknown) => void;
  settled: Promise<void>;
} {
  let markSeen!: () => void;
  let releaseResponse!: (value: { status: number; body: unknown }) => void;
  let markSettled!: () => void;
  const requestSeen = new Promise<void>((resolve) => {
    markSeen = resolve;
  });
  const response = new Promise<{ status: number; body: unknown }>((resolve) => {
    releaseResponse = resolve;
  });
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });

  return {
    requestSeen,
    settled,
    release(status, body) {
      releaseResponse({ status, body });
    },
    async handler(route) {
      markSeen();
      const released = await response;
      await route
        .fulfill({
          status: released.status,
          contentType: "application/json",
          body: JSON.stringify(released.body)
        })
        .catch(() => undefined);
      markSettled();
    }
  };
}

async function searchPayload(
  page: Parameters<typeof searchFor>[0],
  query: string
) {
  const response = await page.request.get(
    `/api/search?q=${encodeURIComponent(query)}`
  );
  expect(response.status()).toBe(200);
  return response.json();
}
