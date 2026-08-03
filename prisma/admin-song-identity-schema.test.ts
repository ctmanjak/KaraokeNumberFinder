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
const concurrentIndex = readFileSync(
  path.join(
    root,
    "prisma/contract-migrations/20260727091000_contract_song_normalized_identity/create-index-concurrently.sql"
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
      'normalizedCanonicalTitle  String?        @map("normalized_canonical_title") @db.VarChar(512)'
    );
    expect(schema).toContain(
      'normalizedCanonicalArtist String?        @map("normalized_canonical_artist") @db.VarChar(512)'
    );
    expect(schema).not.toContain(
      "@@unique([normalizedCanonicalTitle, normalizedCanonicalArtist]"
    );
    expect(concurrentIndex).toMatch(/CREATE UNIQUE INDEX CONCURRENTLY/u);
    expect(concurrentIndex).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/u);
    expect(contract).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/iu);
    expect(contract).toMatch(/CHECK \([\s\S]*\) NOT VALID/u);
    expect(contract).toMatch(/VALIDATE CONSTRAINT/u);
    expect(contract).toMatch(/UNIQUE USING INDEX/u);
    expect(contract).toContain("First execute create-index-concurrently.sql");
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

  it("rolls back only the contract unique constraint", () => {
    expect(rollback.trim()).toBe(
      `ALTER TABLE "songs"
  DROP CONSTRAINT IF EXISTS "songs_normalized_canonical_title_artist_key";`
    );
    expect(rollback.match(/\bDROP\s+CONSTRAINT\b/giu) ?? []).toHaveLength(1);
    expect(rollback.match(/;/gu) ?? []).toHaveLength(1);
    expect(rollback).not.toMatch(
      /\b(?:DROP\s+COLUMN|DROP\s+TABLE|TRUNCATE|DELETE|UPDATE)\b/iu
    );
  });
});
