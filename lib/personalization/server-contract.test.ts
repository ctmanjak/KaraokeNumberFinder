import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("personalization server boundary", () => {
  it("marks the Better Auth and database entry point as server-only", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/personalization/server.ts"),
      "utf8"
    );

    expect(source).toMatch(/^import "server-only";/u);
  });

  it("does not re-export the server entry from the pure helper barrel", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/personalization/index.ts"),
      "utf8"
    );

    expect(source).not.toMatch(/from "\.\/server"/u);
  });
});
