import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import {
  DuplicateCheckRepositoryError,
  findDuplicateCandidates
} from "./repository";

describe("duplicate candidate repository", () => {
  it("uses one timeout-scoped candidate statement and returns the redacted projection", async () => {
    const transaction = {
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => [
        {
          id: "song_a",
          displayTitle: "레몬",
          canonicalTitle: "Lemon",
          canonicalArtist: "Artist",
          originalLanguage: "ja",
          releaseYear: 2018,
          tieIn: null,
          exactIdentity: true,
          titleStrength: 3,
          titleInputField: "canonical_title",
          titleCandidateField: "song.canonical_title",
          titleMatchedValue: "Lemon",
          artistStrength: 3,
          artistCandidateField: "song.canonical_artist",
          artistMatchedValue: "Artist",
          providerSummary: [
            {
              provider_id: "tj",
              provider_name: "TJ",
              karaoke_number: "12345",
              version_info: ""
            }
          ]
        }
      ])
    };
    const db = {
      $transaction: vi.fn(async (run) => run(transaction))
    } as unknown as PrismaClient;

    const result = await findDuplicateCandidates(db, {
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "Artist"
    });

    expect(transaction.$executeRawUnsafe).toHaveBeenCalledWith(
      "SET LOCAL statement_timeout = '1000ms'"
    );
    expect(transaction.$executeRawUnsafe).toHaveBeenLastCalledWith(
      "SET LOCAL statement_timeout = '0'"
    );
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    const candidateCalls = transaction.$queryRaw.mock.calls as unknown as Array<
      [unknown]
    >;
    const candidateSql = candidateCalls[0]?.[0] as
      { strings?: readonly string[] } | undefined;
    expect(candidateSql?.strings?.join(" ")).toContain("strpos");
    expect(candidateSql?.strings?.join(" ")).not.toMatch(/\bLIKE\b/u);
    expect(result).toMatchObject({
      classification: "exact",
      candidates: [
        {
          id: "song_a",
          admin_path: "/admin/songs/song_a",
          provider_summary: [{ provider_name: "TJ" }]
        }
      ]
    });
    expect(JSON.stringify(result)).not.toMatch(
      /source_name|source_url|verification_note|verified_by|email/iu
    );
  });

  it("maps PostgreSQL query cancellation to a timeout instead of no candidates", async () => {
    const transaction = {
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => {
        throw { code: "57014" };
      })
    };
    const db = {
      $transaction: vi.fn(async (run) => run(transaction))
    } as unknown as PrismaClient;
    await expect(
      findDuplicateCandidates(db, {
        canonical_title: "Lemon",
        canonical_artist: "Artist"
      })
    ).rejects.toEqual(new DuplicateCheckRepositoryError("TIMEOUT"));
  });

  it("maps a Prisma P2010 wrapped cancellation to a timeout", async () => {
    const transaction = {
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => {
        throw {
          code: "P2010",
          meta: { code: "57014", message: "canceling statement" }
        };
      })
    };
    const db = {
      $transaction: vi.fn(async (run) => run(transaction))
    } as unknown as PrismaClient;

    await expect(
      findDuplicateCandidates(db, {
        canonical_title: "Lemon",
        canonical_artist: "Artist"
      })
    ).rejects.toEqual(new DuplicateCheckRepositoryError("TIMEOUT"));
  });

  it("maps a Prisma 7 driver-adapter wrapped cancellation to a timeout", async () => {
    const transaction = {
      $executeRawUnsafe: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => {
        throw {
          code: "P2010",
          meta: {
            driverAdapterError: {
              name: "DriverAdapterError",
              cause: {
                kind: "postgres",
                code: "57014",
                originalCode: "57014",
                originalMessage: "canceling statement due to statement timeout"
              }
            }
          }
        };
      })
    };
    const db = {
      $transaction: vi.fn(async (run) => run(transaction))
    } as unknown as PrismaClient;

    await expect(
      findDuplicateCandidates(db, {
        canonical_title: "Lemon",
        canonical_artist: "Artist"
      })
    ).rejects.toEqual(new DuplicateCheckRepositoryError("TIMEOUT"));
  });
});
