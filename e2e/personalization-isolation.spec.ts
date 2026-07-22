import type { BrowserContext, Page } from "@playwright/test";

import {
  completeMockGoogleLogin,
  expect,
  mutationHeaders,
  searchFor,
  test,
  type E2ECatalog,
  type E2EUser
} from "./fixtures";

test("favorites, history, preference, and ownership stay isolated across two browser contexts and account switch", async ({
  browser,
  catalog,
  users
}) => {
  const userA = users.create("isolation-a");
  const userB = users.create("isolation-b");
  const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
  const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await users.login(contextA.request, userA);
    await users.login(contextB.request, userB);
    await seedPreference(contextA, catalog.providers[0].id);
    await seedPreference(contextB, catalog.providers[1].id);

    await recordSearchAndFavorite(pageA, userA, catalog, 0);
    await recordSearchAndFavorite(pageB, userB, catalog, 1);

    const historyA = await readHistory(contextA);
    const historyB = await readHistory(contextB);
    expect(historyA.some(({ query }) => query === catalog.songs[0].query)).toBe(
      true
    );
    expect(historyA.some(({ query }) => query === catalog.songs[1].query)).toBe(
      false
    );
    expect(historyB.some(({ query }) => query === catalog.songs[1].query)).toBe(
      true
    );
    expect(historyB.some(({ query }) => query === catalog.songs[0].query)).toBe(
      false
    );

    const scopedDelete = await contextB.request.delete(
      `/api/favorites/${encodeURIComponent(catalog.songs[0].id)}`,
      { headers: mutationHeaders() }
    );
    expect(scopedDelete.status()).toBe(200);
    const attemptedIdentityInjection = await contextB.request.get(
      `/api/favorites?user_id=${encodeURIComponent(userA.id)}`
    );
    expect(attemptedIdentityInjection.status()).toBe(400);

    const historyDelete = await contextB.request.delete(
      `/api/search-history/${encodeURIComponent(historyA[0].id)}`,
      { headers: mutationHeaders() }
    );
    expect(historyDelete.status()).toBe(200);
    expect(
      ((await historyDelete.json()) as { deleted_count: number }).deleted_count
    ).toBe(0);
    expect(
      (await readHistory(contextA)).some(({ id }) => id === historyA[0].id)
    ).toBe(true);

    await assertFavoritePage(
      pageA,
      catalog.songs[0].display_title,
      catalog.songs[1].display_title
    );
    await assertFavoritePage(
      pageB,
      catalog.songs[1].display_title,
      catalog.songs[0].display_title
    );

    await users.login(contextA.request, userB);
    await pageA.reload();
    await expect(
      pageA.getByRole("button", { name: `${userB.name} 사용자 메뉴` })
    ).toBeVisible();
    await expect(
      pageA.getByRole("heading", { name: catalog.songs[1].display_title })
    ).toBeVisible();
    await expect(
      pageA.getByRole("heading", { name: catalog.songs[0].display_title })
    ).toHaveCount(0);

    await pageA.goto("/");
    await expect(
      pageA.getByRole("button", { name: catalog.songs[1].query, exact: true })
    ).toBeVisible();
    await expect(
      pageA.getByRole("button", { name: catalog.songs[0].query, exact: true })
    ).toHaveCount(0);
    await expect(pageA.getByLabel("제공사")).toHaveValue(
      catalog.providers[1].id
    );
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("guest local history and provider merge on login and restore in a fresh browser context", async ({
  page,
  browser,
  catalog,
  users
}) => {
  const user = users.create("local-merge");
  await page.goto("/");
  const providerSelect = page.getByLabel("제공사");
  await expect(providerSelect).toBeVisible();
  const initialProvider = await providerSelect.inputValue();
  const localProvider = catalog.providers.find(
    ({ id }) => id !== initialProvider
  );
  expect(localProvider !== undefined).toBe(true);
  await providerSelect.selectOption(localProvider?.id ?? "");
  await searchFor(page, catalog.songs[0]);
  await expect(
    page.getByRole("button", { name: catalog.songs[0].query, exact: true })
  ).toBeVisible();

  await page.reload();
  await expect(providerSelect).toHaveValue(localProvider?.id ?? "");
  await expect(
    page.getByRole("button", { name: catalog.songs[0].query, exact: true })
  ).toBeVisible();

  await completeMockGoogleLogin({
    page,
    users,
    user,
    trigger: page.getByRole("button", { name: "Google 로그인", exact: true })
  });
  await expect(providerSelect).toHaveValue(localProvider?.id ?? "");
  await expect(
    page.getByRole("button", { name: catalog.songs[0].query, exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        history: localStorage.getItem("knf:v1:recent-searches"),
        provider: localStorage.getItem("knf:v1:default-provider")
      }))
    )
    .toEqual({ history: null, provider: null });

  const freshContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await users.login(freshContext.request, user);
    const freshPage = await freshContext.newPage();
    await freshPage.goto("/");
    await expect(freshPage.getByLabel("제공사")).toHaveValue(
      localProvider?.id ?? ""
    );
    await expect(
      freshPage.getByRole("button", {
        name: catalog.songs[0].query,
        exact: true
      })
    ).toBeVisible();
  } finally {
    await freshContext.close();
  }
});

async function seedPreference(
  context: BrowserContext,
  providerId: string
): Promise<void> {
  const response = await context.request.put(
    "/api/user-preference/default-provider",
    { headers: mutationHeaders(), data: { provider_id: providerId } }
  );
  expect(response.status()).toBe(200);
}

async function recordSearchAndFavorite(
  page: Page,
  user: E2EUser,
  catalog: E2ECatalog,
  songIndex: number
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: `${user.name} 사용자 메뉴` })
  ).toBeVisible();
  const historyResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search-history" &&
      response.request().method() === "POST"
  );
  await searchFor(page, catalog.songs[songIndex]);
  expect((await historyResponse).status()).toBe(200);

  const favoriteButton = page.getByRole("button", {
    name: `${catalog.songs[songIndex].display_title} 즐겨찾기에 추가`
  });
  const favoriteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/favorites/${catalog.songs[songIndex].id}` &&
      response.request().method() === "PUT"
  );
  await favoriteButton.click();
  expect((await favoriteResponse).status()).toBe(200);
  await expect(
    page.getByRole("button", {
      name: `${catalog.songs[songIndex].display_title} 즐겨찾기에서 제거`
    })
  ).toHaveAttribute("aria-pressed", "true");
}

async function readHistory(
  context: BrowserContext
): Promise<Array<{ id: string; query: string }>> {
  const response = await context.request.get("/api/search-history");
  expect(response.status()).toBe(200);
  return (
    (await response.json()) as {
      items: Array<{ id: string; query: string }>;
    }
  ).items;
}

async function assertFavoritePage(
  page: Page,
  expectedTitle: string,
  otherTitle: string
): Promise<void> {
  await page.goto("/favorites");
  await expect(
    page.getByRole("heading", { name: expectedTitle })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: otherTitle })).toHaveCount(0);
}
