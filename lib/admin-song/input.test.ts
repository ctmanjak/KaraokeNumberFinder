import { describe, expect, it } from "vitest";

import { parseAdminSongInput } from "./input";

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
      verification_note: null,
      aliases: [
        {
          alias: "Yonezu Kenshi Lemon",
          language: "en",
          alias_type: "romanized_title"
        }
      ],
      karaoke_entries: [
        {
          provider_id: "tj",
          karaoke_number: "28822",
          version_info: "",
          availability_status: "available",
          last_verified_at: "2026-07-22"
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
            alias_type: "canonical_title"
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
    delete missingKey.verification_note;

    expect(() => parseAdminSongInput(missingKey)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" })
    );
  });

  it.each([
    ["canonical_title", { canonical_title: "---" }],
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
    verification_note: null,
    aliases: [
      {
        alias: "Yonezu Kenshi Lemon",
        language: "en",
        alias_type: "romanized_title"
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
    last_verified_at: "2026-07-22"
  };
}
