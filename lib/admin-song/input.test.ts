import { describe, expect, it } from "vitest";

import { parseAdminSongInput, validateAdminSongCreateAggregate } from "./input";

describe("admin song input", () => {
  it("normalizes a valid song request", () => {
    expect(parseAdminSongInput(validInput())).toEqual({
      original_language: "ja",
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "米津玄師",
      release_year: 2018,
      tie_in: null,
      source_url: "https://example.com/catalog",
      source_name: "Official catalog",
      aliases: [
        {
          alias: "Yonezu Kenshi Lemon",
          language: "en",
          alias_type: "romanized_title",
          source_name: "Alias catalog",
          source_url: null
        }
      ],
      karaoke_entries: [
        {
          provider_id: "tj",
          karaoke_number: "28822",
          version_info: "",
          availability_status: "available",
          last_verified_at: "2026-07-22",
          source_name: "TJ catalog",
          source_url: null,
          verification_note: null
        }
      ]
    });
  });

  it.each([
    ["unknown field", { unexpected: true }],
    [
      "available without a number",
      { karaoke_entries: [{ ...validEntry(), karaoke_number: "" }] }
    ],
    [
      "unavailable with a number",
      {
        karaoke_entries: [
          { ...validEntry(), availability_status: "not_available" }
        ]
      }
    ],
    [
      "invalid provider date",
      { karaoke_entries: [{ ...validEntry(), last_verified_at: "2026-02-30" }] }
    ],
    ["no provider entries", { karaoke_entries: [] }],
    ["unsafe source URL", { source_url: "javascript:alert(1)" }]
  ])("rejects %s", (_name, patch) => {
    expect(() =>
      parseAdminSongInput({ ...validInput(), ...patch })
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("rejects duplicate generated or provider rows", () => {
    expect(() =>
      parseAdminSongInput({
        ...validInput(),
        aliases: [
          {
            alias: " Lemon ",
            language: "en",
            alias_type: "english_title"
          }
        ]
      })
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));

    expect(() =>
      parseAdminSongInput({
        ...validInput(),
        karaoke_entries: [validEntry(), validEntry()]
      })
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("rejects normalized administrator duplicates across editable alias types", () => {
    expect(() =>
      parseAdminSongInput({
        ...validInput(),
        aliases: [
          {
            alias: "Alternate",
            language: "en",
            alias_type: "english_title"
          },
          {
            alias: "Ａｌｔｅｒｎａｔｅ！",
            language: "ko",
            alias_type: "common_name"
          }
        ]
      })
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("reports an indexed path for an invalid alias type", () => {
    expect(() =>
      parseAdminSongInput({
        ...validInput(),
        aliases: [
          validInput().aliases[0],
          {
            alias: "System alias",
            language: "en",
            alias_type: "canonical_title",
            source_name: null,
            source_url: null
          }
        ]
      })
    ).toThrowError(
      expect.objectContaining({
        details: {
          issues: [expect.objectContaining({ path: "aliases.1.alias_type" })]
        }
      })
    );
  });

  it("rejects a request with a missing key", () => {
    const missingKey: Partial<ReturnType<typeof validInput>> = validInput();
    delete missingKey.source_name;

    expect(() => parseAdminSongInput(missingKey)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" })
    );
  });

  it.each([
    ["canonical_title", { canonical_title: "---" }],
    ["display_title", { display_title: "---" }],
    ["normalized_canonical_title", { normalized_canonical_title: "forged" }]
  ])("includes the raw field path for identity error %s", (path, patch) => {
    expect(() =>
      parseAdminSongInput({ ...validInput(), ...patch })
    ).toThrowError(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        details: {
          issues: [expect.objectContaining({ path })]
        }
      })
    );
  });

  it("applies the shared entry status, future-date, and indexed path rules", () => {
    expect(() =>
      parseAdminSongInput(
        {
          ...validInput(),
          karaoke_entries: [
            {
              ...validEntry(),
              availability_status: "not_available",
              karaoke_number: "",
              verification_note: null
            }
          ]
        },
        new Date("2026-07-28T00:00:00.000Z")
      )
    ).toThrowError(
      expect.objectContaining({
        details: {
          issues: [
            expect.objectContaining({
              path: "karaoke_entries.0.verification_note"
            })
          ]
        }
      })
    );
    expect(() =>
      parseAdminSongInput(
        {
          ...validInput(),
          karaoke_entries: [{ ...validEntry(), last_verified_at: "2026-07-29" }]
        },
        new Date("2026-07-28T00:00:00.000Z")
      )
    ).toThrowError(
      expect.objectContaining({
        details: {
          issues: [
            expect.objectContaining({
              path: "karaoke_entries.0.last_verified_at"
            })
          ]
        }
      })
    );
    expect(() =>
      parseAdminSongInput({
        ...validInput(),
        karaoke_entries: [{ ...validEntry(), last_verified_at: null }]
      })
    ).toThrowError(
      expect.objectContaining({
        details: {
          issues: [
            expect.objectContaining({
              path: "karaoke_entries.0.last_verified_at"
            })
          ]
        }
      })
    );
  });

  it("uses the KST service date for future-date validation", () => {
    const duringKstCrossover = new Date("2026-07-27T15:30:00.000Z");
    expect(() =>
      parseAdminSongInput(
        {
          ...validInput(),
          karaoke_entries: [{ ...validEntry(), last_verified_at: "2026-07-28" }]
        },
        duringKstCrossover
      )
    ).not.toThrow();
    expect(() =>
      parseAdminSongInput(
        {
          ...validInput(),
          karaoke_entries: [{ ...validEntry(), last_verified_at: "2026-07-29" }]
        },
        duringKstCrossover
      )
    ).toThrowError(
      expect.objectContaining({
        details: {
          issues: [
            expect.objectContaining({
              path: "karaoke_entries.0.last_verified_at"
            })
          ]
        }
      })
    );
  });

  it("reports candidate acknowledgement limits separately from duplicate IDs", () => {
    const currentDate = new Date("2026-07-28T12:00:00.000Z");
    const tooManyIds = Array.from({ length: 6 }, (_, index) => `song-${index}`);
    const limitIssue = expect.objectContaining({
      path: "possible_duplicate_acknowledged_song_ids",
      message: "At most 5 candidate IDs may be acknowledged.",
      max: 5
    });

    expect(() =>
      parseAdminSongInput(
        {
          ...validInput(),
          possible_duplicate_acknowledged_song_ids: tooManyIds
        },
        currentDate
      )
    ).toThrowError(
      expect.objectContaining({
        details: { issues: [limitIssue] }
      })
    );

    const parsed = parseAdminSongInput(validInput(), currentDate);
    expect(() =>
      validateAdminSongCreateAggregate(
        {
          ...parsed,
          possible_duplicate_acknowledged_song_ids: tooManyIds
        },
        currentDate
      )
    ).toThrowError(
      expect.objectContaining({
        details: { issues: [limitIssue] }
      })
    );
    expect(() =>
      validateAdminSongCreateAggregate(
        {
          ...parsed,
          possible_duplicate_acknowledged_song_ids: ["song-a", "song-a"]
        },
        currentDate
      )
    ).toThrowError(
      expect.objectContaining({
        details: {
          issues: [
            expect.objectContaining({
              path: "possible_duplicate_acknowledged_song_ids",
              message: "Candidate IDs must be unique.",
              max: 5
            })
          ]
        }
      })
    );
  });

  it.each([
    [
      "missing alias field",
      () => {
        const alias = { ...validInput().aliases[0] };
        delete (alias as Partial<typeof alias>).source_name;
        return { ...validInput(), aliases: [alias] };
      },
      "aliases.0.source_name"
    ],
    [
      "unknown entry field",
      () => ({
        ...validInput(),
        karaoke_entries: [{ ...validEntry(), unexpected: true }]
      }),
      "karaoke_entries.0.unexpected"
    ]
  ])("reports the indexed path for a %s", (_name, input, path) => {
    expect(() => parseAdminSongInput(input())).toThrowError(
      expect.objectContaining({
        details: {
          issues: [expect.objectContaining({ path })]
        }
      })
    );
  });

  it("accepts 30 aliases and 20 entries but rejects 31 and 21", () => {
    const aliases = Array.from({ length: 30 }, (_, index) => ({
      alias: `Unique alias ${index}`,
      language: "en",
      alias_type: "alternate_spelling",
      source_name: null,
      source_url: null
    }));
    const entries = Array.from({ length: 20 }, (_, index) => ({
      ...validEntry(),
      version_info: `version-${index}`
    }));

    expect(() =>
      parseAdminSongInput({
        ...validInput(),
        aliases,
        karaoke_entries: entries
      })
    ).not.toThrow();
    for (const [field, value, max] of [
      ["aliases", [...aliases, { ...aliases[0], alias: "Alias 31" }], 30],
      [
        "karaoke_entries",
        [...entries, { ...validEntry(), version_info: "version-21" }],
        20
      ]
    ] as const) {
      expect(() =>
        parseAdminSongInput({ ...validInput(), [field]: value })
      ).toThrowError(
        expect.objectContaining({
          details: {
            issues: [expect.objectContaining({ path: field, max })]
          }
        })
      );
    }
  });
});

function validInput() {
  return {
    original_language: " ja ",
    canonical_title: " Lemon ",
    display_title: "레몬",
    canonical_artist: "米津玄師",
    release_year: 2018,
    tie_in: null,
    source_url: "https://example.com/catalog",
    source_name: "Official catalog",
    aliases: [
      {
        alias: "Yonezu Kenshi Lemon",
        language: "en",
        alias_type: "romanized_title",
        source_name: "Alias catalog",
        source_url: null
      }
    ],
    karaoke_entries: [validEntry()]
  };
}

function validEntry() {
  return {
    provider_id: "tj",
    karaoke_number: "28822",
    version_info: "",
    availability_status: "available",
    last_verified_at: "2026-07-22",
    source_name: "TJ catalog",
    source_url: null,
    verification_note: null
  };
}
