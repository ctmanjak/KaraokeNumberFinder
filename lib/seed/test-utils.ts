import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SeedFileName } from "./validate";

export const TEST_SEED_FILES = [
  "karaoke_providers.csv",
  "songs.csv",
  "song_aliases.csv",
  "karaoke_entries.csv"
] as const satisfies readonly SeedFileName[];

export function makeSeedDir(
  validSeedDir: string,
  prefix: string,
  overrides: Partial<Record<SeedFileName, string>>
): string {
  const seedDir = mkdtempSync(path.join(tmpdir(), prefix));

  for (const file of TEST_SEED_FILES) {
    writeFileSync(
      path.join(seedDir, file),
      overrides[file] ?? readFixture(validSeedDir, file),
      "utf8"
    );
  }

  return seedDir;
}

export function readFixture(validSeedDir: string, file: SeedFileName): string {
  return readFileSync(path.join(validSeedDir, file), "utf8");
}

export function cleanupSeedDirs(seedDirs: string[]): void {
  for (const seedDir of seedDirs) {
    rmSync(seedDir, { recursive: true, force: true });
  }

  seedDirs.length = 0;
}
