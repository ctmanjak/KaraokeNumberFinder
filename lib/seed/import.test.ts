import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  importSeedDirectory,
  type AliasImportData,
  type EntryImportData,
  type ProviderImportData,
  type SeedImportDbClient,
  type SongImportData
} from "./import";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__"
);
const VALID_DIR = path.join(FIXTURES_DIR, "valid");
const INVALID_DIR = path.join(FIXTURES_DIR, "invalid");

describe("importSeedDirectory", () => {
  it("plans dry-run operations without changing the database", async () => {
    const db = new FakeSeedImportDb({
      karaokeProvider: [
        {
          id: "provider_alpha",
          name: "Generic Provider Alpha",
          country: "KR",
          isActive: true,
          displayOrder: 10,
          isDefault: true,
          sourceUrl: "https://example.com/provider-alpha",
          sourceName: "Generic provider source",
          verifiedBy: "ops_fixture",
          verificationNote: "Fixture provider"
        }
      ],
      song: [
        {
          id: "song_fixture_001",
          originalLanguage: "ja",
          canonicalTitle: "Fixture Original Title",
          displayTitle: "Old Display Title",
          canonicalArtist: "Fixture Artist",
          releaseYear: 2024,
          tieIn: "Fixture Series OP",
          sourceUrl: "https://example.com/song",
          sourceName: "Generic song source",
          verifiedBy: "ops_fixture",
          verificationNote: "Fixture song"
        }
      ]
    });
    const before = db.snapshot();

    const result = await importSeedDirectory(db, {
      seedDir: VALID_DIR,
      dryRun: true
    });

    expect(result.applied).toBe(false);
    expect(result.errors).toEqual([]);
    expect(db.snapshot()).toEqual(before);
    expect(db.upsertLog).toEqual([]);
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "karaoke_providers.csv",
          create: 1,
          update: 0,
          skip: 1
        }),
        expect.objectContaining({
          file: "songs.csv",
          create: 0,
          update: 1,
          skip: 0
        }),
        expect.objectContaining({
          file: "song_aliases.csv",
          create: 2,
          update: 0,
          skip: 0
        }),
        expect.objectContaining({
          file: "karaoke_entries.csv",
          create: 2,
          update: 0,
          skip: 0
        })
      ])
    );
  });

  it("imports valid CSV rows in provider, song, alias, entry order", async () => {
    const db = new FakeSeedImportDb();

    const result = await importSeedDirectory(db, { seedDir: VALID_DIR });

    expect(result.applied).toBe(true);
    expect(result.errors).toEqual([]);
    expect(db.upsertLog).toEqual([
      "karaokeProvider:provider_alpha",
      "karaokeProvider:provider_beta",
      "song:song_fixture_001",
      "songAlias:alias_fixture_001_ko",
      "songAlias:alias_fixture_001_ro",
      "karaokeEntry:entry_fixture_001_alpha",
      "karaokeEntry:entry_fixture_001_beta"
    ]);
    expect(db.store.karaokeProvider.size).toBe(2);
    expect(db.store.song.size).toBe(1);
    expect(db.store.songAlias.size).toBe(2);
    expect(db.store.karaokeEntry.size).toBe(2);
  });

  it("does not plan or import when validation fails", async () => {
    const db = new FakeSeedImportDb();

    const result = await importSeedDirectory(db, { seedDir: INVALID_DIR });

    expect(result.applied).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.rows).toEqual([]);
    expect(db.findCount).toBe(0);
    expect(db.upsertLog).toEqual([]);
  });

  it("rolls back the full transaction when an upsert fails", async () => {
    const db = new FakeSeedImportDb({
      failOnUpsertId: "alias_fixture_001_ro"
    });

    await expect(
      importSeedDirectory(db, { seedDir: VALID_DIR })
    ).rejects.toThrow("forced upsert failure for alias_fixture_001_ro");
    expect(db.store.karaokeProvider.size).toBe(0);
    expect(db.store.song.size).toBe(0);
    expect(db.store.songAlias.size).toBe(0);
    expect(db.store.karaokeEntry.size).toBe(0);
  });
});

type Store = {
  karaokeProvider: Map<string, ProviderImportData>;
  song: Map<string, SongImportData>;
  songAlias: Map<string, AliasImportData>;
  karaokeEntry: Map<string, EntryImportData>;
};

type InitialData = Partial<{
  karaokeProvider: ProviderImportData[];
  song: SongImportData[];
  songAlias: AliasImportData[];
  karaokeEntry: EntryImportData[];
  failOnUpsertId: string;
}>;

class FakeSeedImportDb implements SeedImportDbClient {
  readonly store: Store;
  readonly failOnUpsertId?: string;
  upsertLog: string[] = [];
  findCount = 0;

  constructor(initial: InitialData = {}) {
    this.store = {
      karaokeProvider: mapRows(initial.karaokeProvider ?? []),
      song: mapRows(initial.song ?? []),
      songAlias: mapRows(initial.songAlias ?? []),
      karaokeEntry: mapRows(initial.karaokeEntry ?? [])
    };
    this.failOnUpsertId = initial.failOnUpsertId;
  }

  readonly karaokeProvider =
    this.delegate<ProviderImportData>("karaokeProvider");
  readonly song = this.delegate<SongImportData>("song");
  readonly songAlias = this.delegate<AliasImportData>("songAlias");
  readonly karaokeEntry = this.delegate<EntryImportData>("karaokeEntry");

  async $transaction<T>(
    run: (tx: Omit<SeedImportDbClient, "$transaction">) => Promise<T>
  ): Promise<T> {
    const before = this.cloneStore();

    try {
      return await run(this);
    } catch (error) {
      this.replaceStore(before);
      throw error;
    }
  }

  snapshot(): Record<string, unknown> {
    return {
      karaokeProvider: Array.from(this.store.karaokeProvider.values()),
      song: Array.from(this.store.song.values()),
      songAlias: Array.from(this.store.songAlias.values()),
      karaokeEntry: Array.from(this.store.karaokeEntry.values())
    };
  }

  private delegate<TData extends { id: string }>(model: keyof Store) {
    return {
      findMany: async (args: { where: { id: { in: string[] } } }) => {
        this.findCount += 1;
        const ids = new Set(args.where.id.in);
        const table = this.store[model] as unknown as Map<string, TData>;
        return Array.from(table.values()).filter((row) => ids.has(row.id));
      },
      upsert: async (args: {
        where: { id: string };
        create: TData;
        update: Omit<TData, "id">;
      }) => {
        if (args.where.id === this.failOnUpsertId) {
          throw new Error(`forced upsert failure for ${args.where.id}`);
        }

        this.upsertLog.push(`${model}:${args.where.id}`);
        const table = this.store[model] as unknown as Map<string, TData>;
        const current = table.get(args.where.id);
        table.set(args.where.id, {
          ...(current ?? { id: args.where.id }),
          ...(current === undefined ? args.create : args.update)
        } as TData);
      }
    };
  }

  private cloneStore(): Store {
    return {
      karaokeProvider: new Map(this.store.karaokeProvider),
      song: new Map(this.store.song),
      songAlias: new Map(this.store.songAlias),
      karaokeEntry: new Map(this.store.karaokeEntry)
    };
  }

  private replaceStore(store: Store): void {
    this.store.karaokeProvider = store.karaokeProvider;
    this.store.song = store.song;
    this.store.songAlias = store.songAlias;
    this.store.karaokeEntry = store.karaokeEntry;
  }
}

function mapRows<TData extends { id: string }>(
  rows: readonly TData[]
): Map<string, TData> {
  return new Map(rows.map((row) => [row.id, row]));
}
