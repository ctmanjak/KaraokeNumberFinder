import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("search history module boundaries", () => {
  it("keeps Prisma and PostgreSQL locking details in the repository", () => {
    for (const file of [
      "lib/search-history/service.ts",
      "lib/search-history/route-handler.ts"
    ]) {
      expect(read(file)).not.toMatch(
        /generated\/prisma|PrismaClient|FOR UPDATE|\$transaction/u
      );
    }

    expect(read("lib/search-history/repository.ts")).toMatch(
      /generated\/prisma\/client/u
    );
    expect(read("lib/search-history/repository.ts")).toContain("FOR UPDATE");
  });

  it("routes every method through the T04 wrapper and shared lazy singleton", () => {
    for (const file of [
      "app/api/search-history/route.ts",
      "app/api/search-history/[id]/route.ts"
    ]) {
      const source = read(file);
      expect(source).toContain("createServerPersonalizationHandler");
      expect(source).toContain("getSearchHistoryService");
    }
  });

  it("does not couple search history to Favorite or UserPreference", () => {
    for (const file of [
      "lib/search-history/service.ts",
      "lib/search-history/route-handler.ts",
      "lib/search-history/repository.ts",
      "lib/search-history/server.ts"
    ]) {
      expect(read(file)).not.toMatch(/favorites?|user[-_]?preferences?/iu);
    }
  });

  it("keeps public search and provider source isolated from personalization", () => {
    for (const file of [
      "app/api/search/route.ts",
      "app/api/providers/route.ts",
      "lib/search/route-handler.ts",
      "lib/search/search.ts",
      "lib/providers/route-handler.ts",
      "lib/providers/providers.ts"
    ]) {
      expect(read(file)).not.toMatch(
        /search[-_]?history|personalization|favorites?|user[-_]?preference/iu
      );
    }

    expect(read("lib/search-history/service.ts")).toContain(
      "../search/normalize"
    );
    expect(read("lib/search-history/service.ts")).not.toContain(
      "../search/search"
    );
  });
});

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}
