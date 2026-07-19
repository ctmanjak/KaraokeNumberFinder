import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./server");
  vi.doUnmock("../favorites/repository");
  vi.resetModules();
});

describe("public route authentication isolation", () => {
  it("keeps public route modules free of auth/session imports", () => {
    for (const route of [
      "app/api/search/route.ts",
      "app/api/providers/route.ts",
      "lib/search/route-handler.ts",
      "lib/search/search.ts",
      "lib/providers/route-handler.ts",
      "lib/providers/providers.ts"
    ]) {
      const source = readFileSync(path.join(process.cwd(), route), "utf8");
      expect(source).not.toMatch(/auth|session|personalization|favorites?/iu);
    }
  });

  it("keeps search and provider handlers working when auth DB access fails", async () => {
    vi.resetModules();
    const authModuleInitialization = vi.fn(() => {
      return {
        getServerAuth() {
          throw new Error("auth database unavailable");
        },
        getServerAuthRuntime() {
          throw new Error("auth database unavailable");
        }
      };
    });
    const favoriteModuleInitialization = vi.fn(() => {
      throw new Error("favorite database unavailable");
    });
    vi.doMock("./server", () => authModuleInitialization());
    vi.doMock("../favorites/repository", () => favoriteModuleInitialization());
    const [{ createSearchGetHandler }, { createProvidersGetHandler }] =
      await Promise.all([
        import("../search/route-handler"),
        import("../providers/route-handler")
      ]);
    const search = createSearchGetHandler(async () => ({
      query: "hello",
      normalized_query: "hello",
      items: [],
      next_cursor: null,
      suggestions: []
    }));
    const providers = createProvidersGetHandler(async () => []);

    const [searchResponse, providersResponse] = await Promise.all([
      search(new Request("http://localhost/api/search?q=hello")),
      providers(new Request("http://localhost/api/providers"))
    ]);

    expect(searchResponse.status).toBe(200);
    expect(providersResponse.status).toBe(200);
    expect(authModuleInitialization).not.toHaveBeenCalled();
    expect(favoriteModuleInitialization).not.toHaveBeenCalled();

    const authModule = await import("./server");
    expect(authModuleInitialization).toHaveBeenCalledTimes(1);
    expect(() => authModule.getServerAuth()).toThrow(
      "auth database unavailable"
    );
  });
});
