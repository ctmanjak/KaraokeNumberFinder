import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  path.join(
    root,
    "prisma/migrations/20260722090000_add_admin_role/migration.sql"
  ),
  "utf8"
);

describe("admin role schema", () => {
  it("defaults every existing and new user to least privilege", () => {
    expect(schema).toMatch(/enum UserRole\s*\{\s*user\s*admin/u);
    expect(schema).toMatch(/role\s+UserRole\s+@default\(user\)/u);
    expect(migration).toContain(
      'ADD COLUMN "role" "user_role" NOT NULL DEFAULT \'user\''
    );
    expect(migration).not.toMatch(/UPDATE\s+"?users"?/iu);
  });

  it("does not grant admin to a known email or user in migration code", () => {
    expect(migration).not.toMatch(/@|email|user_id/iu);
  });
});
