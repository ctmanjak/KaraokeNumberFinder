import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { formatSeedValidationIssue, validateSeedDirectory } from "./validate";
import { cleanupSeedDirs, makeSeedDir, readFixture } from "./test-utils";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__"
);
const NOW = new Date("2026-07-01T00:00:00.000Z");
const VALID_DIR = path.join(FIXTURES_DIR, "valid");
const tempSeedDirs: string[] = [];

afterEach(() => {
  cleanupSeedDirs(tempSeedDirs);
});

describe("validateSeedDirectory", () => {
  it("accepts a valid seed CSV set", () => {
    const result = validateSeedDirectory(path.join(FIXTURES_DIR, "valid"), {
      now: NOW
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns warnings without errors for stale verification dates", () => {
    const result = validateSeedDirectory(path.join(FIXTURES_DIR, "warning"), {
      now: NOW
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(formatSeedValidationIssue(result.warnings[0])).toBe(
      "karaoke_entries.csv row 2: last_verified_at is older than 180 days"
    );
  });

  it("reports rule violations with file names and row numbers", () => {
    const result = validateSeedDirectory(path.join(FIXTURES_DIR, "invalid"), {
      now: NOW
    });
    const messages = result.errors.map(formatSeedValidationIssue);

    expect(result.errors).toHaveLength(21);
    expect(result.warnings).toHaveLength(0);
    expect(messages).toEqual(
      expect.arrayContaining([
        "karaoke_providers.csv: exactly one active provider must have is_default=true",
        "karaoke_providers.csv row 4: is_active must be one of true, false",
        "karaoke_providers.csv row 4: is_default must be one of true, false",
        "karaoke_providers.csv row 4: duplicate id already used at row 2",
        "songs.csv row 3: duplicate id already used at row 2",
        "song_aliases.csv row 2: song_id song_missing not found in songs.csv",
        expect.stringContaining(
          "song_aliases.csv row 3: alias_type must be one of"
        ),
        "song_aliases.csv row 4: normalized_alias must be fixturesong",
        "song_aliases.csv row 5: chosung_alias must be ㅍㅅㅊㄴㄹ",
        "song_aliases.csv row 6: duplicate song_id + normalized_alias + alias_type already used at row 4",
        "song_aliases.csv row 7: duplicate id already used at row 3",
        "karaoke_entries.csv row 2: song_id song_missing not found in songs.csv",
        "karaoke_entries.csv row 3: provider_id provider_missing not found in karaoke_providers.csv",
        "karaoke_entries.csv row 4: karaoke_number is required when availability_status=available",
        "karaoke_entries.csv row 5: karaoke_number must be empty when availability_status=not_available",
        "karaoke_entries.csv row 6: last_verified_at is required when availability_status=temporarily_unavailable",
        expect.stringContaining(
          "karaoke_entries.csv row 7: availability_status must be one of"
        ),
        "karaoke_entries.csv row 8: source_name is required",
        "karaoke_entries.csv row 10: duplicate song_id + provider_id + version_info + karaoke_number already used at row 9",
        "karaoke_entries.csv row 11: last_verified_at must not be in the future",
        "karaoke_entries.csv row 11: duplicate id already used at row 2"
      ])
    );
  });

  it("reports missing seed files", () => {
    const result = validateSeedDirectory(path.join(FIXTURES_DIR, "missing"), {
      now: NOW
    });

    expect(result.errors).toHaveLength(4);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors.map(formatSeedValidationIssue)).toEqual(
      expect.arrayContaining([
        "karaoke_providers.csv: karaoke_providers.csv is required",
        "songs.csv: songs.csv is required",
        "song_aliases.csv: song_aliases.csv is required",
        "karaoke_entries.csv: karaoke_entries.csv is required"
      ])
    );
  });

  it("rejects numeric and date values that import parsing would reject", () => {
    const seedDir = makeTempSeedDir({
      "karaoke_providers.csv": readFixture(
        VALID_DIR,
        "karaoke_providers.csv"
      ).replace(",10,", ",1e2,"),
      "songs.csv": readFixture(VALID_DIR, "songs.csv").replace(
        ",2024,",
        ",2024.5,"
      ),
      "karaoke_entries.csv": readFixture(
        VALID_DIR,
        "karaoke_entries.csv"
      ).replace("2026-06-25", "2026-02-30")
    });
    const result = validateSeedDirectory(seedDir, { now: NOW });

    expect(result.errors.map(formatSeedValidationIssue)).toEqual(
      expect.arrayContaining([
        "karaoke_providers.csv row 2: display_order must be an integer",
        "songs.csv row 2: release_year must be an integer",
        "karaoke_entries.csv row 2: last_verified_at must be YYYY-MM-DD"
      ])
    );
  });

  it("reports a blank chosung_alias when a Hangul alias requires one", () => {
    const seedDir = makeTempSeedDir({
      "song_aliases.csv": readFixture(VALID_DIR, "song_aliases.csv").replace(
        "픽스처노래,ㅍㅅㅊㄴㄹ,",
        "픽스처노래,,"
      )
    });
    const result = validateSeedDirectory(seedDir, { now: NOW });

    expect(result.errors.map(formatSeedValidationIssue)).toEqual(
      expect.arrayContaining([
        "song_aliases.csv row 2: chosung_alias must be ㅍㅅㅊㄴㄹ"
      ])
    );
  });
});

function makeTempSeedDir(overrides: Parameters<typeof makeSeedDir>[2]): string {
  const seedDir = makeSeedDir(VALID_DIR, "seed-validate-test-", overrides);
  tempSeedDirs.push(seedDir);
  return seedDir;
}
