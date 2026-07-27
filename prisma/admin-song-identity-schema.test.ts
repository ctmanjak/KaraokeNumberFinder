import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const expand = readFileSync(
  path.join(
    root,
    "prisma/migrations/20260727090000_expand_song_normalized_identity/migration.sql"
  ),
  "utf8"
);
const contract = readFileSync(
  path.join(
    root,
    "prisma/contract-migrations/20260727091000_contract_song_normalized_identity/migration.sql"
  ),
  "utf8"
);
const rollback = readFileSync(
  path.join(
    root,
    "prisma/contract-migrations/20260727091000_contract_song_normalized_identity/rollback.sql"
  ),
  "utf8"
);

describe("ADMIN-T03 normalized song identity rollout", () => {
  it("uses a nullable expand before the named NOT NULL unique contract", () => {
    expect(expand).toMatch(
      /ADD COLUMN "normalized_canonical_title" VARCHAR\(512\)/u
    );
    expect(expand).not.toMatch(/NOT NULL|UNIQUE/iu);
    expect(contract).toContain('"songs_normalized_canonical_title_artist_key"');
    expect(contract).toMatch(
      /ALTER COLUMN "normalized_canonical_title" SET NOT NULL/u
    );
    expect(schema).toContain(
      '@map("normalized_canonical_title") @db.VarChar(512)'
    );
    expect(schema).toContain(
      'map: "songs_normalized_canonical_title_artist_key"'
    );
    expect(
      existsSync(
        path.join(
          root,
          "prisma/migrations/20260727091000_contract_song_normalized_identity/migration.sql"
        )
      )
    ).toBe(false);
    expect(contract).toContain(
      "intentionally staged outside prisma/migrations"
    );
  });

  it("rolls back only the new constraint and columns", () => {
    expect(rollback).toMatch(/DROP CONSTRAINT IF EXISTS/u);
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS/u);
    expect(rollback).not.toMatch(
      /DELETE|TRUNCATE|UPDATE\s+"?songs"?|DROP TABLE/iu
    );
  });
});
