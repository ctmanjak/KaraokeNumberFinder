import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { findDuplicateCandidates } from "./repository";

const testDatabaseUrl = process.env.ADMIN_T03_TEST_DATABASE_URL;
const describeDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

describeDatabase("duplicate candidates on disposable PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        max: 5
      })
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("classifies canonical exact, display-title possible, none, and current-song exclusion", async () => {
    await expect(
      findDuplicateCandidates(prisma, {
        canonical_title: "Lemon",
        canonical_artist: "米津玄師"
      })
    ).resolves.toMatchObject({
      classification: "exact",
      candidates: [{ id: "song_ja_0006" }]
    });
    const possible = await findDuplicateCandidates(prisma, {
      canonical_title: "레몬",
      display_title: "레몬",
      canonical_artist: "米津玄師"
    });
    expect(possible.classification).toBe("possible");
    expect(possible.candidates[0].id).toBe("song_ja_0006");
    expect(possible.candidates[0].match_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "title", strength: "exact" }),
        expect.objectContaining({ role: "artist", strength: "exact" })
      ])
    );
    const artistAlias = await findDuplicateCandidates(prisma, {
      canonical_title: "Lemon",
      canonical_artist: "요네즈 켄시"
    });
    expect(artistAlias.classification).toBe("possible");
    expect(artistAlias.candidates[0]).toMatchObject({
      id: "song_ja_0006",
      match_evidence: expect.arrayContaining([
        expect.objectContaining({
          role: "artist",
          strength: "exact",
          candidate_field: "alias.artist",
          matched_value: "요네즈 켄시"
        })
      ])
    });
    await expect(
      findDuplicateCandidates(prisma, {
        canonical_title: "No such title 987654321",
        canonical_artist: "No such artist 987654321"
      })
    ).resolves.toEqual({ classification: "none", candidates: [] });
    const excluded = await findDuplicateCandidates(prisma, {
      canonical_title: "Lemon",
      canonical_artist: "米津玄師",
      exclude_song_id: "song_ja_0006"
    });
    expect(excluded.candidates.map((candidate) => candidate.id)).not.toContain(
      "song_ja_0006"
    );
  });

  it("does not leak the transaction-local statement timeout", async () => {
    await findDuplicateCandidates(prisma, {
      canonical_title: "Lemon",
      canonical_artist: "米津玄師"
    });
    const rows = await prisma.$queryRawUnsafe<Array<{ timeout: string }>>(
      "SELECT current_setting('statement_timeout') AS timeout"
    );
    expect(rows[0].timeout).toBe("0");
  });

  it("treats SQL LIKE metacharacters as literal duplicate input", async () => {
    await expect(
      findDuplicateCandidates(prisma, {
        canonical_title: "%%",
        canonical_artist: "%%"
      })
    ).resolves.toEqual({ classification: "none", candidates: [] });
  });
});
