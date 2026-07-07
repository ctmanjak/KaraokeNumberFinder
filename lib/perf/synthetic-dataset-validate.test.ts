import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCsv, stringifyCsvRows } from "../seed/csv";
import {
  generateSyntheticDataset,
  SYNTHETIC_METADATA_FILE,
  SYNTHETIC_SEARCH_FIXTURE_FILE
} from "./synthetic-dataset";
import {
  validateSyntheticDataset,
  type SyntheticDatasetValidationDbClient
} from "./synthetic-dataset-validate";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("validateSyntheticDataset", () => {
  it("passes files-only validation for generated 1k and 10k datasets", async () => {
    for (const datasetLabel of [
      "synthetic-1k-songs-10k-aliases",
      "synthetic-10k-songs-100k-aliases"
    ] as const) {
      const generated = generateSyntheticDataset({
        datasetLabel,
        outputRoot: makeTempRoot()
      });

      const report = await validateSyntheticDataset({
        seedDir: generated.outputDir,
        datasetLabel,
        filesOnly: true
      });

      expect(report.errors).toEqual([]);
      expect(report.mode).toBe("files-only");
      expect(report.metadata.status).toBe("pass");
      expect(report.fixture_coverage.status).toBe("pass");
      expect(report.file_row_counts.songs).toBe(
        generated.metadata.row_counts.songs
      );
      expect(report.file_row_counts.song_aliases).toBe(
        generated.metadata.row_counts.song_aliases
      );
    }
  });

  it("fails when metadata dataset label does not match the CLI label", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });
    mutateMetadata(generated.outputDir, (metadata) => ({
      ...metadata,
      dataset_label: "synthetic-10k-songs-100k-aliases"
    }));

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      filesOnly: true
    });

    expect(report.errors).toContain(
      "dataset-metadata.json dataset_label synthetic-10k-songs-100k-aliases does not match synthetic-1k-songs-10k-aliases"
    );
    expect(report.metadata.status).toBe("fail");
  });

  it("fails when file row counts do not match the contract", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });
    removeLastCsvRecord(path.join(generated.outputDir, "songs.csv"));

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      filesOnly: true
    });

    expect(report.errors).toContain(
      "songs count 999 does not match expected 1000"
    );
    expect(report.errors).toContain(
      "dataset-metadata.json row_counts.songs 1000 does not match file count 999"
    );
  });

  it("fails malformed seed CSV rows with the wrong column count", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });
    mutateCsvRow(path.join(generated.outputDir, "songs.csv"), 1, (row) => {
      row.pop();
    });

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      filesOnly: true
    });

    expect(report.errors).toContain(
      "songs.csv row 2: expected 11 columns but found 10"
    );
    expect(report.errors).toContain(
      "songs count 999 does not match expected 1000"
    );
  });

  it("fails when a required fixture case is missing", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });
    removeFixtureCase(generated.outputDir, "valid-provider-filter");

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      filesOnly: true
    });

    expect(report.errors).toContain(
      "search-synthetic-scale.csv missing required case_id valid-provider-filter"
    );
    expect(report.fixture_coverage.status).toBe("fail");
  });

  it("fails malformed fixture CSV rows with the wrong column count", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });
    mutateCsvRow(
      path.join(generated.outputDir, SYNTHETIC_SEARCH_FIXTURE_FILE),
      1,
      (row) => {
        row.push("unexpected");
      }
    );

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      filesOnly: true
    });

    expect(report.errors).toContain(
      "search-synthetic-scale.csv row 2: expected 8 columns but found 9"
    );
    expect(report.fixture_coverage.status).toBe("fail");
  });

  it("allows additional fixture cases when metadata row counts match", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });
    appendFixtureCase(generated.outputDir, [
      "extra-operator-case",
      "Extra operator case",
      "extra query",
      "synthetic_1k_song_000001",
      "extra",
      "",
      "synthetic-1k-songs-10k-aliases",
      "Additional fixture rows are allowed by the contract."
    ]);
    mutateMetadata(generated.outputDir, (metadata) => ({
      ...metadata,
      row_counts: {
        ...(metadata.row_counts as Record<string, unknown>),
        search_fixture_cases: 10
      }
    }));

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      filesOnly: true
    });

    expect(report.errors).toEqual([]);
    expect(report.fixture_coverage.status).toBe("pass");
    expect(report.file_row_counts.search_fixture_cases).toBe(10);
  });

  it("fails when fixture dataset labels do not match", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });
    mutateFixtureRow(generated.outputDir, "normalized-exact", (row, header) => {
      row[header.indexOf("dataset_label")] = "synthetic-10k-songs-100k-aliases";
    });

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      filesOnly: true
    });

    expect(report.errors).toContain(
      "search-synthetic-scale.csv row 2: dataset_label synthetic-10k-songs-100k-aliases does not match synthetic-1k-songs-10k-aliases"
    );
  });

  it("fails unsupported dataset labels", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-unknown",
      filesOnly: true
    });

    expect(report.errors).toEqual([
      "unsupported dataset_label synthetic-unknown"
    ]);
  });

  it("validates DB row counts through read-only count delegates", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });
    const calls: unknown[] = [];
    const db = dbClientFor(generated.metadata.row_counts, calls);

    const report = await validateSyntheticDataset({
      seedDir: generated.outputDir,
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      filesOnly: false,
      dbLabel: "local",
      databaseUrl: "postgresql://user:pass@localhost:5432/karaoke",
      db
    });

    expect(report.errors).toEqual([]);
    expect(report.db?.status).toBe("pass");
    expect(calls).toEqual([
      { where: { verificationNote: "synthetic-1k-songs-10k-aliases" } },
      { where: { verificationNote: "synthetic-1k-songs-10k-aliases" } },
      { where: { verificationNote: "synthetic-1k-songs-10k-aliases" } },
      { where: { verificationNote: "synthetic-1k-songs-10k-aliases" } }
    ]);
  });

  it("rejects DB validation for prod-like labels and URLs but allows files-only without DB URL", async () => {
    const generated = generateSyntheticDataset({
      datasetLabel: "synthetic-1k-songs-10k-aliases",
      outputRoot: makeTempRoot()
    });

    await expect(
      validateSyntheticDataset({
        seedDir: generated.outputDir,
        datasetLabel: "synthetic-1k-songs-10k-aliases",
        filesOnly: false,
        dbLabel: "neon",
        databaseUrl: "postgresql://user:pass@localhost:5432/karaoke",
        db: dbClientFor(generated.metadata.row_counts, [])
      })
    ).rejects.toThrow("blocked for db label neon");

    await expect(
      validateSyntheticDataset({
        seedDir: generated.outputDir,
        datasetLabel: "synthetic-1k-songs-10k-aliases",
        filesOnly: false,
        dbLabel: "local",
        databaseUrl: "postgresql://user:pass@ep-test.neon.tech/karaoke",
        db: dbClientFor(generated.metadata.row_counts, [])
      })
    ).rejects.toThrow("DATABASE_URL looks like Neon");

    await expect(
      validateSyntheticDataset({
        seedDir: generated.outputDir,
        datasetLabel: "synthetic-1k-songs-10k-aliases",
        filesOnly: true
      })
    ).resolves.toMatchObject({ errors: [] });
  });
});

function makeTempRoot(): string {
  const dir = path.join(
    os.tmpdir(),
    `karaoke-synthetic-validator-${crypto.randomUUID()}`
  );
  tempDirs.push(dir);
  return dir;
}

function mutateMetadata(
  outputDir: string,
  mutate: (metadata: Record<string, unknown>) => Record<string, unknown>
): void {
  const metadataPath = path.join(outputDir, SYNTHETIC_METADATA_FILE);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<
    string,
    unknown
  >;
  writeFileSync(
    metadataPath,
    `${JSON.stringify(mutate(metadata), null, 2)}\n`,
    "utf8"
  );
}

function removeLastCsvRecord(filePath: string): void {
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  rows.pop();
  writeFileSync(filePath, `${stringifyCsvRows(rows)}\n`, "utf8");
}

function mutateCsvRow(
  filePath: string,
  dataRowIndex: number,
  mutate: (row: string[]) => void
): void {
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  const row = rows[dataRowIndex];
  if (row !== undefined) {
    mutate(row);
  }
  writeFileSync(filePath, `${stringifyCsvRows(rows)}\n`, "utf8");
}

function removeFixtureCase(outputDir: string, caseId: string): void {
  const filePath = path.join(outputDir, SYNTHETIC_SEARCH_FIXTURE_FILE);
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  const header = rows[0] ?? [];
  const caseIdIndex = header.indexOf("case_id");
  const filteredRows = rows.filter(
    (row, index) => index === 0 || row[caseIdIndex] !== caseId
  );
  writeFileSync(filePath, `${stringifyCsvRows(filteredRows)}\n`, "utf8");
}

function mutateFixtureRow(
  outputDir: string,
  caseId: string,
  mutate: (row: string[], header: string[]) => void
): void {
  const filePath = path.join(outputDir, SYNTHETIC_SEARCH_FIXTURE_FILE);
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  const header = rows[0] ?? [];
  const caseIdIndex = header.indexOf("case_id");
  for (const row of rows.slice(1)) {
    if (row[caseIdIndex] === caseId) {
      mutate(row, header);
    }
  }
  writeFileSync(filePath, `${stringifyCsvRows(rows)}\n`, "utf8");
}

function appendFixtureCase(outputDir: string, row: string[]): void {
  const filePath = path.join(outputDir, SYNTHETIC_SEARCH_FIXTURE_FILE);
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  rows.push(row);
  writeFileSync(filePath, `${stringifyCsvRows(rows)}\n`, "utf8");
}

function dbClientFor(
  counts: {
    songs: number;
    song_aliases: number;
    karaoke_entries: number;
    karaoke_providers: number;
  },
  calls: unknown[]
): SyntheticDatasetValidationDbClient {
  return {
    song: {
      count: (args) => {
        calls.push(args);
        return Promise.resolve(counts.songs);
      }
    },
    songAlias: {
      count: (args) => {
        calls.push(args);
        return Promise.resolve(counts.song_aliases);
      }
    },
    karaokeEntry: {
      count: (args) => {
        calls.push(args);
        return Promise.resolve(counts.karaoke_entries);
      }
    },
    karaokeProvider: {
      count: (args) => {
        calls.push(args);
        return Promise.resolve(counts.karaoke_providers);
      }
    }
  };
}
