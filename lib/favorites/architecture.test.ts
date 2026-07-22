import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("favorite module boundaries", () => {
  it("keeps Prisma types in the repository layer", () => {
    for (const file of [
      "lib/favorites/cursor.ts",
      "lib/favorites/service.ts",
      "lib/favorites/route-handler.ts"
    ]) {
      expect(read(file)).not.toMatch(/generated\/prisma|PrismaClient/u);
    }

    expect(read("lib/favorites/repository.ts")).toMatch(
      /generated\/prisma\/client/u
    );
  });

  it("routes every favorite method through the T04 server wrapper", () => {
    for (const file of [
      "app/api/favorites/route.ts",
      "app/api/favorites/[songId]/route.ts"
    ]) {
      const source = read(file);
      expect(source).toContain("createServerPersonalizationHandler");
      expect(source).not.toContain("UserPreference");
      expect(source).not.toContain("SearchHistory");
    }
  });

  it("does not couple favorites to other personalization domains", () => {
    for (const file of [
      "lib/favorites/cursor.ts",
      "lib/favorites/service.ts",
      "lib/favorites/route-handler.ts",
      "lib/favorites/repository.ts"
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/search[-_]?history|user[-_]?preference/iu);
    }
  });
});

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}
