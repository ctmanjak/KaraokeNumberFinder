import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { buildAliasSearchFields } from "../search/normalize";
import { normalizeSongIdentity } from "../song-identity/normalize";
import { findDuplicateCandidates } from "./repository";

const testDatabaseUrl = process.env.ADMIN_T03_TEST_DATABASE_URL;
const describeDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;
const FIXTURE = {
  id: "song_admin_t03_duplicate_fixture",
  canonicalTitle: "ADMIN-T03 Unique Candidate",
  displayTitle: "ADMIN-T03 고유 후보",
  canonicalArtist: "ADMIN-T03 Fixture Artist",
  artistAlias: "ADMIN-T03 별칭 가수"
} as const;

describeDatabase("duplicate candidates on disposable PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        max: 5
      })
    });
    await prisma.song.deleteMany({ where: { id: FIXTURE.id } });
    const identity = normalizeSongIdentity({
      canonical_title: FIXTURE.canonicalTitle,
      canonical_artist: FIXTURE.canonicalArtist
    });
    await prisma.song.create({
      data: {
        id: FIXTURE.id,
        originalLanguage: "en",
        canonicalTitle: FIXTURE.canonicalTitle,
        displayTitle: FIXTURE.displayTitle,
        canonicalArtist: FIXTURE.canonicalArtist,
        normalizedCanonicalTitle: identity.normalizedCanonicalTitle,
        normalizedCanonicalArtist: identity.normalizedCanonicalArtist,
        releaseYear: 2026,
        sourceName: "ADMIN-T03 integration fixture",
        verifiedBy: "integration:admin-t03",
        aliases: {
          create: [
            fixtureAlias(
              "canonical",
              FIXTURE.canonicalTitle,
              "canonical_title"
            ),
            fixtureAlias("display", FIXTURE.displayTitle, "display_title"),
            fixtureAlias("artist", FIXTURE.canonicalArtist, "artist"),
            fixtureAlias("artist-alias", FIXTURE.artistAlias, "artist")
          ]
        }
      }
    });
  });

  afterAll(async () => {
    await prisma.song.deleteMany({ where: { id: FIXTURE.id } });
    await prisma.$disconnect();
  });

  it("classifies canonical exact, display-title possible, none, and current-song exclusion", async () => {
    await expect(
      findDuplicateCandidates(prisma, {
        canonical_title: FIXTURE.canonicalTitle,
        canonical_artist: FIXTURE.canonicalArtist
      })
    ).resolves.toMatchObject({
      classification: "exact",
      candidates: [{ id: FIXTURE.id }]
    });
    const possible = await findDuplicateCandidates(prisma, {
      canonical_title: FIXTURE.displayTitle,
      display_title: FIXTURE.displayTitle,
      canonical_artist: FIXTURE.canonicalArtist
    });
    expect(possible.classification).toBe("possible");
    expect(possible.candidates[0].id).toBe(FIXTURE.id);
    expect(possible.candidates[0].match_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "title", strength: "exact" }),
        expect.objectContaining({ role: "artist", strength: "exact" })
      ])
    );
    const artistAlias = await findDuplicateCandidates(prisma, {
      canonical_title: FIXTURE.canonicalTitle,
      canonical_artist: FIXTURE.artistAlias
    });
    expect(artistAlias.classification).toBe("possible");
    expect(artistAlias.candidates[0]).toMatchObject({
      id: FIXTURE.id,
      match_evidence: expect.arrayContaining([
        expect.objectContaining({
          role: "artist",
          strength: "exact",
          candidate_field: "alias.artist",
          matched_value: FIXTURE.artistAlias
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
      canonical_title: FIXTURE.canonicalTitle,
      canonical_artist: FIXTURE.canonicalArtist,
      exclude_song_id: FIXTURE.id
    });
    expect(excluded.candidates.map((candidate) => candidate.id)).not.toContain(
      FIXTURE.id
    );
  });

  it("does not leak the transaction-local statement timeout", async () => {
    await findDuplicateCandidates(prisma, {
      canonical_title: FIXTURE.canonicalTitle,
      canonical_artist: FIXTURE.canonicalArtist
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

function fixtureAlias(
  suffix: string,
  value: string,
  aliasType: "canonical_title" | "display_title" | "artist"
) {
  const search = buildAliasSearchFields(value);
  return {
    id: `alias_admin_t03_duplicate_${suffix}`,
    alias: value,
    language: "en",
    aliasType,
    normalizedAlias: search.normalizedAlias,
    chosungAlias: search.chosungAlias || null,
    sourceName: "ADMIN-T03 integration fixture",
    verifiedBy: "integration:admin-t03"
  };
}
