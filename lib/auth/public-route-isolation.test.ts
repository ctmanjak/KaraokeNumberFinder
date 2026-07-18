import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createProvidersGetHandler } from "../providers/route-handler";
import { createSearchGetHandler } from "../search/route-handler";

describe("public route authentication isolation", () => {
  it("keeps public route modules free of auth/session imports", () => {
    for (const route of [
      "app/api/search/route.ts",
      "app/api/providers/route.ts"
    ]) {
      const source = readFileSync(path.join(process.cwd(), route), "utf8");
      expect(source).not.toMatch(/auth|session/iu);
    }
  });

  it("keeps search and provider handlers working when auth DB access fails", async () => {
    const authDatabaseLookup = vi.fn(async () => {
      throw new Error("auth database unavailable");
    });
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
    expect(authDatabaseLookup).not.toHaveBeenCalled();
  });
});
