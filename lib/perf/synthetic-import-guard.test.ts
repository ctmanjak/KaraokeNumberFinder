import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SYNTHETIC_METADATA_FILE } from "./synthetic-dataset";
import {
  assertSyntheticImportAllowed,
  looksProductionLikeDatabaseUrl
} from "./synthetic-import-guard";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("assertSyntheticImportAllowed", () => {
  it("does not require a synthetic target label for ordinary seed directories", () => {
    const seedDir = makeTempDir();

    expect(
      assertSyntheticImportAllowed({
        seedDir,
        databaseUrl: "postgresql://user:pass@db.example.com/app"
      })
    ).toMatchObject({
      synthetic: false,
      datasetLabel: null
    });
  });

  it("allows synthetic import only for local and sandbox labels", () => {
    const seedDir = makeSyntheticDir();

    expect(
      assertSyntheticImportAllowed({
        seedDir,
        dbLabel: "local",
        databaseUrl: "postgresql://user:pass@localhost:5432/karaoke"
      })
    ).toMatchObject({
      synthetic: true,
      targetLabel: "local"
    });
    expect(
      assertSyntheticImportAllowed({
        seedDir,
        dbLabel: "sandbox",
        databaseUrl: "postgresql://user:pass@sandbox.internal/karaoke"
      })
    ).toMatchObject({
      synthetic: true,
      targetLabel: "sandbox"
    });
  });

  it("rejects synthetic imports without an explicit local or sandbox target", () => {
    const seedDir = makeSyntheticDir();

    expect(() =>
      assertSyntheticImportAllowed({
        seedDir,
        databaseUrl: "postgresql://user:pass@localhost:5432/karaoke"
      })
    ).toThrow(
      "Synthetic import requires --db-label local, --db-label sandbox, or --allow-synthetic-import-to-local."
    );
  });

  it("rejects neon, production, prod, and live target labels", () => {
    const seedDir = makeSyntheticDir();

    for (const dbLabel of ["neon", "production", "prod", "live"]) {
      expect(() =>
        assertSyntheticImportAllowed({
          seedDir,
          dbLabel,
          databaseUrl: "postgresql://user:pass@localhost:5432/karaoke"
        })
      ).toThrow(`Synthetic import is blocked for db label ${dbLabel}`);
    }
  });

  it("rejects production-like DATABASE_URL values even with a local label", () => {
    const seedDir = makeSyntheticDir();

    for (const databaseUrl of [
      "postgresql://user:pass@ep-small-neon-123.us-east-1.aws.neon.tech/app",
      "postgresql://prod_user:pass@db.example.com/karaoke",
      "postgresql://user:pass@db.example.com/live",
      "postgresql://prod_user:pass@localhost:5432/karaoke",
      "postgresql://user:pass@127.0.0.1:5432/prod"
    ]) {
      expect(() =>
        assertSyntheticImportAllowed({
          seedDir,
          dbLabel: "local",
          databaseUrl
        })
      ).toThrow("DATABASE_URL looks like Neon");
    }
  });
});

describe("looksProductionLikeDatabaseUrl", () => {
  it("allows localhost URLs and detects remote prod-like URLs", () => {
    expect(
      looksProductionLikeDatabaseUrl(
        "postgresql://user:pass@localhost:5432/karaoke"
      )
    ).toBe(false);
    expect(
      looksProductionLikeDatabaseUrl(
        "postgresql://user:pass@127.0.0.1:5432/karaoke"
      )
    ).toBe(false);
    expect(
      looksProductionLikeDatabaseUrl(
        "postgresql://user:pass@localhost:5432/prod"
      )
    ).toBe(true);
    expect(
      looksProductionLikeDatabaseUrl(
        "postgresql://user:pass@ep-test.neon.tech/karaoke"
      )
    ).toBe(true);
  });
});

function makeSyntheticDir(): string {
  const dir = makeTempDir();
  writeFileSync(
    path.join(dir, SYNTHETIC_METADATA_FILE),
    `${JSON.stringify({
      dataset_label: "synthetic-1k-songs-10k-aliases"
    })}\n`,
    "utf8"
  );
  return dir;
}

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "karaoke-synthetic-guard-"));
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}
