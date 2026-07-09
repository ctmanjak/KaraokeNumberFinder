import { describe, expect, it } from "vitest";

import {
  InvalidProviderError,
  clearActiveProviderCache,
  parseSearchQuery,
  searchSongs,
  type SearchDbClient
} from "./search";
import { matchesAliasWhere } from "./test-where-match";

describe("parseSearchQuery", () => {
  it("defaults limit to 20 and normalizes q", () => {
    expect(parseSearchQuery(new URLSearchParams("q=Fixture%20Query"))).toEqual({
      ok: true,
      query: {
        query: "Fixture Query",
        normalizedQuery: "fixturequery",
        chosungQuery: "fixturequery",
        limit: 20
      }
    });
  });

  it("accepts provider_id and explicit limit", () => {
    expect(
      parseSearchQuery(
        new URLSearchParams("q=fixture&provider_id=provider_alpha&limit=50")
      )
    ).toEqual({
      ok: true,
      query: {
        query: "fixture",
        normalizedQuery: "fixture",
        chosungQuery: "fixture",
        limit: 50,
        providerId: "provider_alpha"
      }
    });
  });

  it("rejects missing, blank, non-integer, and out-of-range values", () => {
    expect(parseSearchQuery(new URLSearchParams())).toMatchObject({
      ok: false,
      code: "INVALID_QUERY"
    });
    expect(parseSearchQuery(new URLSearchParams("q=%20%20"))).toMatchObject({
      ok: false,
      code: "INVALID_QUERY"
    });
    expect(
      parseSearchQuery(new URLSearchParams("q=fixture&limit=two"))
    ).toMatchObject({
      ok: false,
      code: "INVALID_QUERY"
    });
    expect(
      parseSearchQuery(new URLSearchParams("q=fixture&limit=0"))
    ).toMatchObject({
      ok: false,
      code: "INVALID_QUERY"
    });
  });
});

describe("searchSongs", () => {
  it("returns normalized exact match results with aliases and entries", async () => {
    const db = new FakeSearchDb({
      songs: [
        song({
          id: "song_fixture_001",
          aliases: [
            alias({
              id: "alias_fixture_001_ko",
              songId: "song_fixture_001",
              alias: "Fixture Alias",
              normalizedAlias: "fixturealias"
            })
          ],
          karaokeEntries: [
            entry({
              id: "entry_fixture_001_alpha",
              songId: "song_fixture_001",
              providerId: "provider_alpha",
              lastVerifiedAt: "2026-06-25"
            })
          ]
        })
      ]
    });

    await expect(
      searchSongs(db, parsedQuery("q=Fixture%20Alias"), {
        now: new Date("2026-07-02T00:00:00.000Z")
      })
    ).resolves.toEqual({
      query: "Fixture Alias",
      normalized_query: "fixturealias",
      items: [
        {
          song: {
            id: "song_fixture_001",
            original_language: "ja",
            canonical_title: "Fixture Original Title",
            display_title: "Fixture Display Title",
            canonical_artist: "Fixture Artist",
            release_year: 2026,
            tie_in: "Fixture Series OP",
            matched_aliases: [
              {
                id: "alias_fixture_001_ko",
                alias: "Fixture Alias",
                language: "ko",
                alias_type: "translated_title"
              }
            ]
          },
          karaoke_entries: [
            {
              id: "entry_fixture_001_alpha",
              provider_id: "provider_alpha",
              karaoke_number: "12345",
              version_info: "original",
              availability_status: "available",
              last_verified_at: "2026-06-25",
              is_stale: false
            }
          ],
          distinguishing_labels: [
            "Fixture Artist",
            "Fixture Series OP",
            "2026"
          ],
          relevance_score: 100
        }
      ],
      next_cursor: null,
      suggestions: []
    });
  });

  it("maps raw candidate/detail rows without Prisma alias fan-out", async () => {
    const db = new FakeSearchDb({
      rawRows: [
        rawAliasRow({
          alias_id: "alias_fixture_raw",
          alias_song_id: "song_fixture_raw",
          alias: "Fixture Raw",
          normalized_alias: "fixtureraw",
          song_id: "song_fixture_raw",
          display_title: "Fixture Raw Display",
          karaoke_entry_id: "entry_fixture_raw_alpha"
        }),
        rawAliasRow({
          alias_id: "alias_fixture_raw",
          alias_song_id: "song_fixture_raw",
          alias: "Fixture Raw",
          normalized_alias: "fixtureraw",
          song_id: "song_fixture_raw",
          display_title: "Fixture Raw Display",
          karaoke_entry_id: "entry_fixture_raw_beta",
          provider_id: "provider_beta",
          karaoke_number: "67890"
        })
      ]
    });

    const result = await searchSongs(db, parsedQuery("q=Fixture%20Raw"));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      song: {
        id: "song_fixture_raw",
        display_title: "Fixture Raw Display",
        matched_aliases: [{ id: "alias_fixture_raw", alias: "Fixture Raw" }]
      },
      karaoke_entries: [
        { id: "entry_fixture_raw_alpha", provider_id: "provider_alpha" },
        { id: "entry_fixture_raw_beta", provider_id: "provider_beta" }
      ],
      relevance_score: 100
    });
    expect(db.rawQueryCalls).toBe(1);
    expect(db.aliasFindManyArgs).toEqual([]);
  });

  it("records search timing labels for result and suggestion paths", async () => {
    const successfulTiming = timingRecorder();
    const suggestionTiming = timingRecorder();
    const db = new FakeSearchDb({
      songs: [
        song({
          id: "song_fixture_001",
          aliases: [
            alias({
              id: "alias_fixture_001_ko",
              songId: "song_fixture_001",
              alias: "Fixture Alias",
              normalizedAlias: "fixturealias"
            })
          ]
        }),
        song({
          id: "song_fixture_suggestion",
          aliases: [
            alias({
              id: "alias_fixture_suggestion",
              songId: "song_fixture_suggestion",
              alias: "Fix Suggestion",
              normalizedAlias: "fixsuggestion"
            })
          ]
        })
      ]
    });

    await searchSongs(db, parsedQuery("q=Fixture%20Alias"), {
      timing: successfulTiming
    });
    await searchSongs(db, parsedQuery("q=fixzz"), {
      timing: suggestionTiming
    });

    expect(successfulTiming.labels()).toEqual(
      expect.arrayContaining([
        "search.providers",
        "search.candidates.total",
        "search.alias_detail",
        "search.rank",
        "search.to_response_items"
      ])
    );
    expect(suggestionTiming.labels()).toEqual(
      expect.arrayContaining([
        "search.providers",
        "search.candidates.total",
        "search.suggestions"
      ])
    );
  });

  it("supports prefix and partial matches", async () => {
    const db = new FakeSearchDb({
      songs: [
        song({
          id: "song_fixture_001",
          aliases: [
            alias({
              songId: "song_fixture_001",
              alias: "Fixture Prefix Title",
              normalizedAlias: "fixtureprefixtitle"
            })
          ]
        }),
        song({
          id: "song_fixture_002",
          displayTitle: "Fixture Second Display",
          aliases: [
            alias({
              id: "alias_fixture_002_mid",
              songId: "song_fixture_002",
              alias: "Another Fixture Center",
              normalizedAlias: "anotherfixturecenter"
            })
          ]
        })
      ]
    });

    const result = await searchSongs(db, parsedQuery("q=fixture"));

    expect(result.items.map((item) => item.song.id)).toEqual([
      "song_fixture_001",
      "song_fixture_002"
    ]);
    expect(result.items.map((item) => item.relevance_score)).toEqual([80, 60]);
    expect(candidateQueryShapes(db)).toEqual([
      "normalized_equals",
      "normalized_starts_with",
      "normalized_contains"
    ]);
  });

  it("does not fan out to lower-priority candidate queries for exact matches", async () => {
    const db = new FakeSearchDb({
      songs: [
        song({
          id: "song_fixture_exact",
          aliases: [
            alias({
              id: "alias_fixture_exact",
              songId: "song_fixture_exact",
              alias: "Fixture Exact",
              normalizedAlias: "fixtureexact"
            })
          ]
        }),
        song({
          id: "song_fixture_contains",
          displayTitle: "Fixture Contains",
          aliases: [
            alias({
              id: "alias_fixture_contains",
              songId: "song_fixture_contains",
              alias: "Another Fixture Exact Center",
              normalizedAlias: "anotherfixtureexactcenter"
            })
          ]
        })
      ]
    });

    const result = await searchSongs(db, parsedQuery("q=Fixture%20Exact"));

    expect(result.items.map((item) => item.song.id)).toEqual([
      "song_fixture_exact"
    ]);
    expect(candidateQueryShapes(db)).toEqual([
      "normalized_equals",
      "normalized_starts_with"
    ]);
  });

  it("uses Hangul chosung search only from two or more initials", async () => {
    const db = new FakeSearchDb({
      songs: [
        song({
          id: "song_fixture_chosung",
          aliases: [
            alias({
              songId: "song_fixture_chosung",
              alias: "가나다 곡",
              normalizedAlias: "가나다곡",
              chosungAlias: "ㄱㄴㄷㄱ"
            })
          ]
        })
      ]
    });

    const twoInitials = await searchSongs(db, parsedQuery("q=ㄱㄴ"));
    const oneInitial = await searchSongs(db, parsedQuery("q=ㄱ"));

    expect(twoInitials.items.map((item) => item.song.id)).toEqual([
      "song_fixture_chosung"
    ]);
    expect(oneInitial.items).toEqual([]);
    expect(candidateQueryShapes(db)).toEqual([
      "normalized_equals",
      "normalized_starts_with",
      "chosung_starts_with",
      "normalized_contains",
      "normalized_equals",
      "normalized_starts_with",
      "normalized_contains"
    ]);
  });

  it("routes composite final consonants through normal search", async () => {
    const compositeFinalQuery = "ㄱㄳ";
    const db = new FakeSearchDb({
      songs: [
        song({
          id: "song_fixture_composite_jamo",
          aliases: [
            alias({
              songId: "song_fixture_composite_jamo",
              alias: "Composite Jamo",
              normalizedAlias: `fixture${compositeFinalQuery.normalize(
                "NFKC"
              )}center`,
              chosungAlias: "ㄱㄳㄷ"
            })
          ]
        })
      ]
    });

    const result = await searchSongs(db, parsedQuery("q=ㄱㄳ&limit=20"));

    expect(result.items.map((item) => item.song.id)).toEqual([
      "song_fixture_composite_jamo"
    ]);
    expect(result.items[0]?.relevance_score).toBe(60);
    expect(candidateQueryShapes(db)).toEqual([
      "normalized_equals",
      "normalized_starts_with",
      "normalized_contains"
    ]);
  });

  it("falls back to contains when chosung candidates do not fill the result limit", async () => {
    const db = new FakeSearchDb({
      songs: [
        song({
          id: "song_fixture_chosung",
          aliases: [
            alias({
              songId: "song_fixture_chosung",
              alias: "가나다 곡",
              normalizedAlias: "가나다곡",
              chosungAlias: "ㄱㄴㄷㄱ"
            })
          ]
        }),
        song({
          id: "song_fixture_contains_jamo",
          displayTitle: "Fixture Contains Jamo",
          aliases: [
            alias({
              id: "alias_fixture_contains_jamo",
              songId: "song_fixture_contains_jamo",
              alias: "Contains Jamo",
              normalizedAlias: "fixtureᄀᄂcenter",
              chosungAlias: null
            })
          ]
        })
      ]
    });

    const result = await searchSongs(db, parsedQuery("q=ㄱㄴ&limit=20"));

    expect(result.items.map((item) => item.song.id)).toEqual([
      "song_fixture_chosung",
      "song_fixture_contains_jamo"
    ]);
    expect(result.items.map((item) => item.relevance_score)).toEqual([70, 60]);
    expect(candidateQueryShapes(db)).toEqual([
      "normalized_equals",
      "normalized_starts_with",
      "chosung_starts_with",
      "normalized_contains"
    ]);
  });

  it("sorts by requested provider availability before default provider availability", async () => {
    const db = new FakeSearchDb({
      providers: [
        provider({ id: "provider_alpha", isDefault: true }),
        provider({ id: "provider_beta", isDefault: false })
      ],
      songs: [
        song({
          id: "song_fixture_default",
          displayTitle: "Fixture Default",
          aliases: [
            alias({
              songId: "song_fixture_default",
              alias: "Fixture Rank",
              normalizedAlias: "fixturerank"
            })
          ],
          karaokeEntries: [
            entry({
              songId: "song_fixture_default",
              providerId: "provider_alpha"
            })
          ]
        }),
        song({
          id: "song_fixture_requested",
          displayTitle: "Fixture Requested",
          aliases: [
            alias({
              id: "alias_fixture_requested",
              songId: "song_fixture_requested",
              alias: "Fixture Rank",
              normalizedAlias: "fixturerank"
            })
          ],
          karaokeEntries: [
            entry({
              id: "entry_fixture_requested_beta",
              songId: "song_fixture_requested",
              providerId: "provider_beta"
            })
          ]
        })
      ]
    });

    const result = await searchSongs(
      db,
      parsedQuery("q=Fixture%20Rank&provider_id=provider_beta")
    );

    expect(result.items.map((item) => item.song.id)).toEqual([
      "song_fixture_requested",
      "song_fixture_default"
    ]);
  });

  it("sorts by default provider availability and available entry count", async () => {
    const db = new FakeSearchDb({
      providers: [
        provider({ id: "provider_alpha", isDefault: true }),
        provider({ id: "provider_beta", isDefault: false }),
        provider({ id: "provider_gamma", isDefault: false })
      ],
      songs: [
        song({
          id: "song_fixture_many",
          displayTitle: "Fixture Many",
          aliases: [
            alias({
              songId: "song_fixture_many",
              alias: "Fixture Shared",
              normalizedAlias: "fixtureshared"
            })
          ],
          karaokeEntries: [
            entry({ songId: "song_fixture_many", providerId: "provider_beta" }),
            entry({
              id: "entry_fixture_many_gamma",
              songId: "song_fixture_many",
              providerId: "provider_gamma"
            })
          ]
        }),
        song({
          id: "song_fixture_default",
          displayTitle: "Fixture Default",
          aliases: [
            alias({
              id: "alias_fixture_default",
              songId: "song_fixture_default",
              alias: "Fixture Shared",
              normalizedAlias: "fixtureshared"
            })
          ],
          karaokeEntries: [
            entry({
              id: "entry_fixture_default_alpha",
              songId: "song_fixture_default",
              providerId: "provider_alpha"
            })
          ]
        })
      ]
    });

    const result = await searchSongs(db, parsedQuery("q=Fixture%20Shared"));

    expect(result.items.map((item) => item.song.id)).toEqual([
      "song_fixture_default",
      "song_fixture_many"
    ]);
  });

  it("applies limit after ranking", async () => {
    const db = new FakeSearchDb({
      songs: [
        song({
          id: "song_fixture_001",
          aliases: [
            alias({
              songId: "song_fixture_001",
              alias: "Fixture Limit",
              normalizedAlias: "fixturelimit"
            })
          ]
        }),
        song({
          id: "song_fixture_002",
          displayTitle: "Fixture Limit B",
          aliases: [
            alias({
              id: "alias_fixture_002_limit",
              songId: "song_fixture_002",
              alias: "Fixture Limit",
              normalizedAlias: "fixturelimit"
            })
          ]
        })
      ]
    });

    const result = await searchSongs(
      db,
      parsedQuery("q=Fixture%20Limit&limit=1")
    );

    expect(result.items).toHaveLength(1);
  });

  it("keeps exact matches even when partial matches exceed the partial tier cap", async () => {
    const partialSongs = Array.from({ length: 250 }, (_, index) => {
      const paddedIndex = index.toString().padStart(3, "0");

      return song({
        id: `song_fixture_partial_${paddedIndex}`,
        displayTitle: `Fixture Partial ${paddedIndex}`,
        aliases: [
          alias({
            id: `alias_fixture_partial_${paddedIndex}`,
            songId: `song_fixture_partial_${paddedIndex}`,
            alias: `A Partial Fixture ${paddedIndex}`,
            normalizedAlias: `apartialfixture${paddedIndex}`
          })
        ]
      });
    });
    const exactSong = song({
      id: "song_fixture_exact_late",
      displayTitle: "Fixture Exact Late",
      aliases: [
        alias({
          id: "alias_fixture_exact_late",
          songId: "song_fixture_exact_late",
          alias: "Fixture",
          normalizedAlias: "fixture"
        })
      ]
    });
    const db = new FakeSearchDb({
      songs: [...partialSongs, exactSong]
    });

    const result = await searchSongs(db, parsedQuery("q=fixture&limit=1"));

    expect(result.items.map((item) => item.song.id)).toEqual([
      "song_fixture_exact_late"
    ]);
    expect(result.items[0]?.relevance_score).toBe(100);
  });

  it("formats last_verified_at and marks entries stale after 180 days", async () => {
    const db = new FakeSearchDb({
      songs: [
        song({
          aliases: [
            alias({
              alias: "Fixture Date",
              normalizedAlias: "fixturedate"
            })
          ],
          karaokeEntries: [
            entry({
              id: "entry_fixture_fresh",
              lastVerifiedAt: "2026-01-03"
            }),
            entry({
              id: "entry_fixture_stale",
              providerId: "provider_beta",
              lastVerifiedAt: "2026-01-02"
            }),
            entry({
              id: "entry_fixture_unknown_date",
              providerId: "provider_gamma",
              lastVerifiedAt: null
            })
          ]
        })
      ]
    });

    const result = await searchSongs(db, parsedQuery("q=Fixture%20Date"), {
      now: new Date("2026-07-02T12:00:00.000Z")
    });

    expect(
      result.items[0]?.karaoke_entries.map((item) => ({
        id: item.id,
        last_verified_at: item.last_verified_at,
        is_stale: item.is_stale
      }))
    ).toEqual([
      {
        id: "entry_fixture_fresh",
        last_verified_at: "2026-01-03",
        is_stale: false
      },
      {
        id: "entry_fixture_stale",
        last_verified_at: "2026-01-02",
        is_stale: true
      },
      {
        id: "entry_fixture_unknown_date",
        last_verified_at: null,
        is_stale: false
      }
    ]);
  });

  it("rejects provider_id values that do not reference active providers", async () => {
    const db = new FakeSearchDb({
      providers: [
        provider({ id: "provider_alpha", isDefault: true, isActive: true }),
        provider({ id: "provider_inactive", isDefault: false, isActive: false })
      ]
    });

    await expect(
      searchSongs(db, parsedQuery("q=fixture&provider_id=provider_inactive"))
    ).rejects.toBeInstanceOf(InvalidProviderError);
  });

  it("reuses active providers across repeated calls for the same db client", async () => {
    const db = new FakeSearchDb({
      providers: [
        provider({ id: "provider_alpha", isDefault: true }),
        provider({ id: "provider_beta", isDefault: false })
      ],
      songs: [
        song({
          id: "song_fixture_default",
          displayTitle: "Fixture Default",
          aliases: [
            alias({
              songId: "song_fixture_default",
              alias: "Fixture Cached",
              normalizedAlias: "fixturecached"
            })
          ],
          karaokeEntries: [
            entry({
              songId: "song_fixture_default",
              providerId: "provider_alpha"
            })
          ]
        }),
        song({
          id: "song_fixture_requested",
          displayTitle: "Fixture Requested",
          aliases: [
            alias({
              id: "alias_fixture_requested_cached",
              songId: "song_fixture_requested",
              alias: "Fixture Cached",
              normalizedAlias: "fixturecached"
            })
          ],
          karaokeEntries: [
            entry({
              id: "entry_fixture_requested_beta",
              songId: "song_fixture_requested",
              providerId: "provider_beta"
            })
          ]
        })
      ]
    });

    try {
      await expect(
        searchSongs(
          db,
          parsedQuery("q=Fixture%20Cached&provider_id=provider_beta")
        )
      ).resolves.toMatchObject({
        items: [
          { song: { id: "song_fixture_requested" } },
          { song: { id: "song_fixture_default" } }
        ]
      });
      await expect(
        searchSongs(db, parsedQuery("q=Fixture%20Cached"))
      ).resolves.toMatchObject({
        items: [
          { song: { id: "song_fixture_default" } },
          { song: { id: "song_fixture_requested" } }
        ]
      });
      await expect(
        searchSongs(db, parsedQuery("q=fixture&provider_id=provider_missing"))
      ).rejects.toBeInstanceOf(InvalidProviderError);

      expect(db.providerFindManyCalls).toBe(1);
    } finally {
      clearActiveProviderCache(db);
    }
  });

  it("returns up to five alias suggestions when no songs match", async () => {
    const db = new FakeSearchDb({
      songs: Array.from({ length: 6 }, (_, index) => {
        const sequence = (index + 1).toString().padStart(3, "0");

        return song({
          id: `song_fixture_suggestion_${sequence}`,
          aliases: [
            alias({
              id: `alias_fixture_suggestion_${sequence}`,
              alias: `Fixture Suggestion ${sequence}`,
              normalizedAlias: `fixturesuggestion${sequence}`
            })
          ]
        });
      })
    });

    const result = await searchSongs(db, parsedQuery("q=fixzz"));

    expect(result.items).toEqual([]);
    expect(result.suggestions).toEqual([
      "Fixture Suggestion 001",
      "Fixture Suggestion 002",
      "Fixture Suggestion 003",
      "Fixture Suggestion 004",
      "Fixture Suggestion 005"
    ]);
  });
});

type ProviderRecord = Awaited<
  ReturnType<SearchDbClient["karaokeProvider"]["findMany"]>
>[number];
type AliasRecord = Extract<
  Awaited<ReturnType<SearchDbClient["songAlias"]["findMany"]>>[number],
  { song: unknown }
>;
type AliasIdRecord = Extract<
  Awaited<ReturnType<SearchDbClient["songAlias"]["findMany"]>>[number],
  { id: string }
>;
type AliasSuggestionRecord = Extract<
  Awaited<ReturnType<SearchDbClient["songAlias"]["findMany"]>>[number],
  { alias: string; normalizedAlias: string }
>;
type SongRecord = AliasRecord["song"];
type TestSongRecord = SongRecord & { aliases: AliasRecord[] };
type EntryRecord = SongRecord["karaokeEntries"][number];
type FindManyArgs = Parameters<SearchDbClient["songAlias"]["findMany"]>[0];
type RawAliasRow = {
  alias_id: string;
  alias_song_id: string;
  alias: string;
  language: string;
  alias_type: string;
  normalized_alias: string;
  chosung_alias: string | null;
  song_id: string;
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  release_year: number | null;
  tie_in: string | null;
  karaoke_entry_id: string | null;
  provider_id: string | null;
  karaoke_number: string | null;
  version_info: string | null;
  availability_status: string | null;
  last_verified_at: string | null;
};

class FakeSearchDb implements SearchDbClient {
  private readonly providers: ProviderRecord[];
  private readonly aliases: AliasRecord[];
  private readonly rawRows?: RawAliasRow[];
  readonly $queryRaw?: SearchDbClient["$queryRaw"];
  readonly aliasFindManyArgs: FindManyArgs[] = [];
  providerFindManyCalls = 0;
  rawQueryCalls = 0;

  constructor(options: {
    providers?: ProviderRecord[];
    songs?: TestSongRecord[];
    rawRows?: RawAliasRow[];
  }) {
    this.providers = options.providers ?? [
      provider({ id: "provider_alpha", isDefault: true }),
      provider({ id: "provider_beta", isDefault: false })
    ];
    this.aliases = (options.songs ?? []).flatMap((item) =>
      item.aliases.map((songAlias) => ({
        ...songAlias,
        songId: item.id,
        song: item
      }))
    );
    this.rawRows = options.rawRows;

    if (this.rawRows !== undefined) {
      this.$queryRaw = async <T = unknown>() => {
        this.rawQueryCalls += 1;

        return this.rawRows as T;
      };
    }
  }

  readonly karaokeProvider = {
    findMany: async () => {
      this.providerFindManyCalls += 1;

      return this.providers
        .filter((item) => item.isActive)
        .sort((left, right) => left.id.localeCompare(right.id));
    }
  };

  readonly songAlias = {
    findMany: async (args: FindManyArgs) => {
      this.aliasFindManyArgs.push(args);

      return selectAliasFields(
        this.aliases
          .filter((item) => matchesAliasWhere(item, args.where))
          .sort(
            (left, right) =>
              left.normalizedAlias.localeCompare(right.normalizedAlias) ||
              left.songId.localeCompare(right.songId) ||
              left.alias.localeCompare(right.alias) ||
              left.id.localeCompare(right.id)
          )
          .slice(0, args.take),
        args.select
      );
    }
  };
}

function selectAliasFields(
  aliases: AliasRecord[],
  select: FindManyArgs["select"]
): Array<AliasIdRecord | AliasSuggestionRecord | AliasRecord> {
  if ("alias" in select && !("song" in select)) {
    return aliases.map((item) => ({
      id: item.id,
      alias: item.alias,
      normalizedAlias: item.normalizedAlias
    }));
  }

  if (!("song" in select)) {
    return aliases.map((item) => ({ id: item.id }));
  }

  return aliases;
}

function parsedQuery(query: string) {
  const parsed = parseSearchQuery(new URLSearchParams(query));

  if (!parsed.ok) {
    throw new Error(parsed.message);
  }

  return parsed.query;
}

function timingRecorder() {
  const calls: Array<{ name: string; durationMs: number }> = [];

  return {
    record(name: string, durationMs: number) {
      calls.push({ name, durationMs });
    },
    labels() {
      return calls.map((call) => call.name);
    }
  };
}

function candidateQueryShapes(db: FakeSearchDb): string[] {
  return db.aliasFindManyArgs
    .map((args) => args.where)
    .filter(
      (
        where
      ): where is Exclude<
        FindManyArgs["where"],
        { id: unknown } | { OR: unknown }
      > => !("id" in where) && !("OR" in where)
    )
    .map(testConditionTimingName);
}

function testConditionTimingName(
  condition: Exclude<FindManyArgs["where"], { id: unknown } | { OR: unknown }>
): string {
  if ("chosungAlias" in condition) {
    return "chosung_starts_with";
  }

  if ("equals" in condition.normalizedAlias) {
    return "normalized_equals";
  }

  if ("startsWith" in condition.normalizedAlias) {
    return "normalized_starts_with";
  }

  return "normalized_contains";
}

function provider(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: "provider_alpha",
    isActive: true,
    isDefault: false,
    ...overrides
  };
}

function rawAliasRow(overrides: Partial<RawAliasRow> = {}): RawAliasRow {
  return {
    alias_id: "alias_fixture_001_ko",
    alias_song_id: "song_fixture_001",
    alias: "Fixture Alias",
    language: "ko",
    alias_type: "translated_title",
    normalized_alias: "fixturealias",
    chosung_alias: null,
    song_id: "song_fixture_001",
    original_language: "ja",
    canonical_title: "Fixture Original Title",
    display_title: "Fixture Display Title",
    canonical_artist: "Fixture Artist",
    release_year: 2026,
    tie_in: "Fixture Series OP",
    karaoke_entry_id: "entry_fixture_001_alpha",
    provider_id: "provider_alpha",
    karaoke_number: "12345",
    version_info: "original",
    availability_status: "available",
    last_verified_at: "2026-06-25",
    ...overrides
  };
}

function song(overrides: Partial<TestSongRecord> = {}): TestSongRecord {
  const id = overrides.id ?? "song_fixture_001";

  return {
    id,
    originalLanguage: "ja",
    canonicalTitle: "Fixture Original Title",
    displayTitle: "Fixture Display Title",
    canonicalArtist: "Fixture Artist",
    releaseYear: 2026,
    tieIn: "Fixture Series OP",
    aliases: [alias({ songId: id })],
    karaokeEntries: [entry({ songId: id })],
    ...overrides
  };
}

function alias(overrides: Partial<AliasRecord> = {}): AliasRecord {
  const songId = overrides.songId ?? "song_fixture_001";

  return {
    id: "alias_fixture_001",
    songId,
    alias: "Fixture Alias",
    language: "ko",
    aliasType: "translated_title",
    normalizedAlias: "fixturealias",
    chosungAlias: null,
    song: undefined as unknown as SongRecord,
    ...overrides
  };
}

function entry(
  overrides: Partial<EntryRecord> & { songId?: string } = {}
): EntryRecord {
  const entryOverrides = { ...overrides };
  delete entryOverrides.songId;

  return {
    id: "entry_fixture_001_alpha",
    providerId: "provider_alpha",
    karaokeNumber: "12345",
    versionInfo: "original",
    availabilityStatus: "available",
    lastVerifiedAt: "2026-06-25",
    ...entryOverrides
  };
}
