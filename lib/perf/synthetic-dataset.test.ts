import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCsvRows } from "../seed/csv";
import { validateSeedDirectory } from "../seed/validate";
import {
  generateSyntheticDataset,
  REQUIRED_SYNTHETIC_CASE_IDS,
  SYNTHETIC_GENERATOR_VERSION,
  SYNTHETIC_METADATA_FILE,
  SYNTHETIC_SEARCH_FIXTURE_FILE,
  type SyntheticDatasetLabel
} from "./synthetic-dataset";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("generateSyntheticDataset", () => {
  it("generates deterministic 1k dataset rows, fixture cases, and metadata", async () => {
    const firstRoot = makeTempRoot();
    const secondRoot = makeTempRoot();

    const first = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: firstRoot
    });
    const second = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: secondRoot
    });

    expect(first.metadata).toEqual(second.metadata);
    expect(first.sampleIds).toEqual(second.sampleIds);
    expect(first.metadata.generator_version).toBe(SYNTHETIC_GENERATOR_VERSION);
    expect(first.metadata.random_seed).toBe(1009);
    expect(first.metadata.row_counts).toMatchObject({
      songs: 1_000,
      song_aliases: 10_000,
      karaoke_providers: 6
    });
    expect(first.metadata.row_counts.karaoke_entries).toBeGreaterThanOrEqual(
      2_000
    );
    expect(first.metadata.row_counts.karaoke_entries).toBeLessThanOrEqual(
      5_000
    );

    await expectSameFile(
      path.join(first.outputDir, "songs.csv"),
      path.join(second.outputDir, "songs.csv")
    );
    await expectSameFile(
      path.join(first.outputDir, "song_aliases.csv"),
      path.join(second.outputDir, "song_aliases.csv")
    );
    expectRequiredFixtureCases(first.outputDir, first.metadata.dataset_label);

    const validation = validateSeedDirectory(first.outputDir, {
      now: new Date("2026-07-06T00:00:00.000Z")
    });
    expect(validation.errors).toEqual([]);
  });

  it("generates 10k dataset exact song and alias counts within contract ranges", () => {
    const root = makeTempRoot();
    const result = generateSyntheticDataset({
      datasetLabel: "synthetic-10k-songs-100k-aliases",
      outputRoot: root
    });

    expect(result.metadata.random_seed).toBe(10009);
    expect(result.metadata.row_counts.songs).toBe(10_000);
    expect(result.metadata.row_counts.song_aliases).toBe(100_000);
    expect(result.metadata.row_counts.karaoke_providers).toBeGreaterThanOrEqual(
      4
    );
    expect(result.metadata.row_counts.karaoke_providers).toBeLessThanOrEqual(
      20
    );
    expect(result.metadata.row_counts.karaoke_entries).toBeGreaterThanOrEqual(
      20_000
    );
    expect(result.metadata.row_counts.karaoke_entries).toBeLessThanOrEqual(
      50_000
    );
    expectRequiredFixtureCases(result.outputDir, result.metadata.dataset_label);
  });
});

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "karaoke-synthetic-test-"));
  tempDirs.push(dir);
  return dir;
}

async function expectSameFile(left: string, right: string): Promise<void> {
  const rightText = await readFile(right, "utf8");
  await expect(readFile(left, "utf8")).resolves.toBe(rightText);
}

function expectRequiredFixtureCases(
  outputDir: string,
  datasetLabel: SyntheticDatasetLabel
): void {
  const fixtureRows = readCsvRows(
    path.join(outputDir, SYNTHETIC_SEARCH_FIXTURE_FILE)
  );
  const metadataRows = JSON.parse(
    readFileSyncText(path.join(outputDir, SYNTHETIC_METADATA_FILE))
  ) as { required_case_ids: string[]; dataset_label: string };
  const header = fixtureRows[0] ?? [];
  const records = fixtureRows
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        header.map((column, index) => [column, row[index] ?? ""])
      )
    );
  const caseIds = new Set(records.map((row) => row.case_id));

  expect(metadataRows.dataset_label).toBe(datasetLabel);
  expect(metadataRows.required_case_ids).toEqual(REQUIRED_SYNTHETIC_CASE_IDS);
  for (const requiredCaseId of REQUIRED_SYNTHETIC_CASE_IDS) {
    expect(caseIds.has(requiredCaseId)).toBe(true);
  }
  expect(records.every((row) => row.dataset_label === datasetLabel)).toBe(true);
}

function readFileSyncText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}
