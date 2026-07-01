import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { addAliasRow, addEntryRow, addSongRow } from "./add";
import { parseCsv } from "./csv";
import { SEED_FILE_HEADERS, validateSeedDirectory } from "./validate";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__"
);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("seed add helpers", () => {
  it("adds a song row with a generated id and preserved CSV header order", () => {
    const seedDir = copyFixture("valid");

    const result = addSongRow(
      {
        original_language: "ja",
        canonical_title: "Second Fixture Title",
        display_title: "두 번째 픽스처",
        canonical_artist: "Second Fixture Artist",
        release_year: "2025",
        source_name: "Generic song source",
        verified_by: "ops_fixture"
      },
      { seedDir }
    );

    const rows = parseSeedFile(seedDir, "songs.csv");

    expect(result.id).toBe("song_ja_0001");
    expect(rows[0]).toEqual(SEED_FILE_HEADERS["songs.csv"]);
    expect(rows.at(-1)).toEqual([
      "song_ja_0001",
      "ja",
      "Second Fixture Title",
      "두 번째 픽스처",
      "Second Fixture Artist",
      "2025",
      "",
      "",
      "Generic song source",
      "ops_fixture",
      ""
    ]);
    expect(result.validation?.errors).toEqual([]);
  });

  it("adds an alias row and derives normalized and chosung alias fields", () => {
    const seedDir = copyFixture("valid");

    const result = addAliasRow(
      {
        song_id: "song_fixture_001",
        alias: "새 픽스처 별칭",
        language: "ko",
        alias_type: "common_name",
        source_name: "Generic alias source",
        verified_by: "ops_fixture"
      },
      { seedDir }
    );

    const row = parseSeedFile(seedDir, "song_aliases.csv").at(-1);

    expect(result.id).toBe("alias_song_fixture_001_common_name_0001");
    expect(row).toEqual([
      "alias_song_fixture_001_common_name_0001",
      "song_fixture_001",
      "새 픽스처 별칭",
      "ko",
      "common_name",
      "새픽스처별칭",
      "ㅅㅍㅅㅊㅂㅊ",
      "",
      "Generic alias source",
      "ops_fixture",
      ""
    ]);
  });

  it("leaves chosung_alias blank for non-Hangul aliases", () => {
    const seedDir = copyFixture("valid");

    addAliasRow(
      {
        song_id: "song_fixture_001",
        alias: "Fixture Song Alt",
        language: "ro",
        alias_type: "alternate_spelling",
        verified_by: "ops_fixture"
      },
      { seedDir }
    );

    const row = parseSeedFile(seedDir, "song_aliases.csv").at(-1);

    expect(row?.[5]).toBe("fixturesongalt");
    expect(row?.[6]).toBe("");
  });

  it("rejects alias rows with a missing song foreign key", () => {
    const seedDir = copyFixture("valid");

    expect(() =>
      addAliasRow(
        {
          song_id: "song_missing",
          alias: "Missing Song Alias",
          language: "en",
          alias_type: "english_title",
          verified_by: "ops_fixture"
        },
        { seedDir }
      )
    ).toThrow("song_id song_missing not found in songs.csv");
  });

  it("rejects duplicate alias candidates before writing", () => {
    const seedDir = copyFixture("valid");

    expect(() =>
      addAliasRow(
        {
          song_id: "song_fixture_001",
          alias: "Fixture Song",
          language: "ro",
          alias_type: "romanized_title",
          verified_by: "ops_fixture"
        },
        { seedDir }
      )
    ).toThrow(
      "duplicate song_id + normalized_alias + alias_type already used at song_aliases.csv row 3"
    );
  });

  it("adds an entry row after checking song and provider CSV foreign keys", () => {
    const seedDir = copyFixture("valid");

    const result = addEntryRow(
      {
        song_id: "song_fixture_001",
        provider_id: "provider_alpha",
        karaoke_number: "67890",
        version_info: "Live",
        availability_status: "available",
        last_verified_at: "2026-06-26",
        source_name: "Generic provider source",
        verified_by: "ops_fixture"
      },
      { seedDir }
    );

    expect(result.id).toBe("entry_song_fixture_001_provider_alpha_live");
    expect(result.validation?.errors).toEqual([]);
  });

  it("rejects duplicate entry candidates", () => {
    const seedDir = copyFixture("valid");

    expect(() =>
      addEntryRow(
        {
          song_id: "song_fixture_001",
          provider_id: "provider_alpha",
          karaoke_number: "12345",
          version_info: "Original",
          availability_status: "available",
          last_verified_at: "2026-06-26",
          source_name: "Generic provider source",
          verified_by: "ops_fixture"
        },
        { seedDir }
      )
    ).toThrow(
      "duplicate song_id + provider_id + version_info + karaoke_number already used at karaoke_entries.csv row 2"
    );
  });

  it("rejects entry status values that violate validation rules", () => {
    const seedDir = copyFixture("valid");

    expect(() =>
      addEntryRow(
        {
          song_id: "song_fixture_001",
          provider_id: "provider_beta",
          karaoke_number: "11111",
          version_info: "TV size",
          availability_status: "not_available",
          last_verified_at: "2026-06-26",
          source_name: "Generic provider source",
          verified_by: "ops_fixture"
        },
        { seedDir }
      )
    ).toThrow(
      "karaoke_number must be empty when availability_status=not_available"
    );
  });

  it("supports fixture-based argument input through the add-alias CLI", () => {
    const seedDir = copyFixture("valid");
    const viteNode = path.join(ROOT_DIR, "node_modules/.bin/vite-node");

    execFileSync(
      viteNode,
      [
        "scripts/seed/add-alias.ts",
        "--seed-dir",
        seedDir,
        "--song-id",
        "song_fixture_001",
        "--alias",
        "Fixture CLI Alias",
        "--language",
        "en",
        "--alias-type",
        "english_title",
        "--verified-by",
        "ops_fixture"
      ],
      { cwd: ROOT_DIR, stdio: "pipe" }
    );

    const result = validateSeedDirectory(seedDir);
    const row = parseSeedFile(seedDir, "song_aliases.csv").at(-1);

    expect(result.errors).toEqual([]);
    expect(row?.[2]).toBe("Fixture CLI Alias");
    expect(row?.[5]).toBe("fixtureclialias");
    expect(row?.[6]).toBe("");
  });
});

function copyFixture(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "seed-add-"));
  cpSync(path.join(FIXTURES_DIR, name), dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function parseSeedFile(seedDir: string, fileName: string): string[][] {
  return parseCsv(readFileSync(path.join(seedDir, fileName), "utf8"));
}
