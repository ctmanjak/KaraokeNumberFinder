import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("user data merge module boundaries", () => {
  it("keeps Prisma and transaction details in the merge repository", () => {
    for (const file of [
      "lib/user-data-merge/service.ts",
      "lib/user-data-merge/route-handler.ts"
    ]) {
      expect(read(file)).not.toMatch(
        /generated\/prisma|PrismaClient|FOR UPDATE|\$transaction/u
      );
    }
    expect(read("lib/user-data-merge/repository.ts")).toContain("FOR UPDATE");
  });

  it("routes merge through the protected wrapper and lazy singleton", () => {
    const route = read("app/api/user-data/merge/route.ts");
    expect(route).toContain("createServerPersonalizationHandler");
    expect(route).toContain("getUserDataMergeService");
  });

  it("does not couple search history or user preference domains to the coordinator", () => {
    for (const file of [
      "lib/search-history/service.ts",
      "lib/search-history/repository.ts",
      "lib/user-preference/service.ts",
      "lib/user-preference/repository.ts"
    ]) {
      expect(read(file)).not.toMatch(/user-data-merge/iu);
    }
  });
});

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}
