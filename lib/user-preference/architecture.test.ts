import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("user preference module boundaries", () => {
  it("keeps Prisma and PostgreSQL details in the repository", () => {
    for (const file of [
      "lib/user-preference/service.ts",
      "lib/user-preference/route-handler.ts"
    ]) {
      expect(read(file)).not.toMatch(
        /generated\/prisma|PrismaClient|FOR UPDATE|\$transaction/u
      );
    }

    expect(read("lib/user-preference/repository.ts")).toMatch(
      /generated\/prisma\/client/u
    );
    expect(read("lib/user-preference/repository.ts")).toContain("FOR UPDATE");
  });

  it("routes both methods through the T04 wrapper and one lazy singleton", () => {
    for (const file of [
      "app/api/user-preference/route.ts",
      "app/api/user-preference/default-provider/route.ts"
    ]) {
      const source = read(file);
      expect(source).toContain("createServerPersonalizationHandler");
      expect(source).toContain("getUserPreferenceService");
    }
  });

  it("does not couple UserPreference to Favorite or SearchHistory", () => {
    for (const file of [
      "lib/user-preference/service.ts",
      "lib/user-preference/route-handler.ts",
      "lib/user-preference/repository.ts",
      "lib/user-preference/server.ts"
    ]) {
      expect(read(file)).not.toMatch(/favorites?|search[-_]?history/iu);
    }
  });

  it("keeps public provider and search modules isolated", () => {
    for (const file of [
      "app/api/search/route.ts",
      "app/api/providers/route.ts",
      "lib/search/route-handler.ts",
      "lib/search/search.ts",
      "lib/providers/route-handler.ts",
      "lib/providers/providers.ts"
    ]) {
      expect(read(file)).not.toMatch(
        /user[-_]?preference|personalization|auth|session/iu
      );
    }
  });
});

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}
