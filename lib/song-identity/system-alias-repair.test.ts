import { describe, expect, it, vi } from "vitest";

import {
  repairMissingSystemAliases,
  requireSystemAliasRepairApplyAuthorization,
  safeRepairDatabaseTarget
} from "./system-alias-repair";

describe("system alias repair", () => {
  it("dry-runs one missing corresponding artist alias without writing", async () => {
    const client = fakeClient();

    const result = await repairMissingSystemAliases(client as never, {
      expectedCreateCount: 1
    });

    expect(result).toMatchObject({
      applied: false,
      before: {
        song_count: 1,
        create_count: 1,
        blockers: [],
        creates: [
          {
            id: "alias_system_song_a_artist",
            song_id: "song_a",
            alias_type: "artist"
          }
        ]
      }
    });
    expect(client.aliases).toHaveLength(3);
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO song_aliases"),
      expect.anything()
    );
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("applies exactly the guarded plan and is idempotent", async () => {
    const client = fakeClient();

    const first = await repairMissingSystemAliases(client as never, {
      apply: true,
      expectedCreateCount: 1
    });
    const second = await repairMissingSystemAliases(client as never, {
      apply: true,
      expectedCreateCount: 0
    });

    expect(first.applied).toBe(true);
    expect(first.before.create_count).toBe(1);
    expect(first.after.create_count).toBe(0);
    expect(second.before.create_count).toBe(0);
    expect(client.query).toHaveBeenCalledWith(
      "SET LOCAL statement_timeout = '15s'"
    );
    expect(
      client.query.mock.calls.some(([statement]) =>
        String(statement).includes("updated_at")
      )
    ).toBe(true);
    expect(client.aliases).toContainEqual(
      expect.objectContaining({
        id: "alias_system_song_a_artist",
        song_id: "song_a",
        alias_type: "artist",
        normalized_alias: "artist"
      })
    );
  });

  it("rolls back before writing when the expected count changes", async () => {
    const client = fakeClient();

    await expect(
      repairMissingSystemAliases(client as never, {
        apply: true,
        expectedCreateCount: 2
      })
    ).rejects.toThrow(/expected 2 creates but found 1/iu);

    expect(client.aliases).toHaveLength(3);
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("requires confirmation, fingerprint, and expected count for apply", () => {
    const target = safeRepairDatabaseTarget(
      "postgresql://user:secret@db.example:5432/catalog?schema=public"
    );
    expect(target).toMatchObject({
      hostname: "db.example",
      port: "5432",
      database: "catalog",
      schema: "public"
    });
    expect(target.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      requireSystemAliasRepairApplyAuthorization({
        apply: true,
        confirmation: "1",
        expectedTargetFingerprint: "wrong",
        actualTargetFingerprint: target.fingerprint,
        expectedCreateCount: 1
      })
    ).toThrow(/explicit confirmation/iu);
    expect(() =>
      requireSystemAliasRepairApplyAuthorization({
        apply: true,
        confirmation: "1",
        expectedTargetFingerprint: target.fingerprint,
        actualTargetFingerprint: target.fingerprint,
        expectedCreateCount: 1
      })
    ).not.toThrow();
  });
});

function fakeClient() {
  const songs = [
    {
      id: "song_a",
      original_language: "en",
      canonical_title: "Title",
      display_title: "Display",
      canonical_artist: "Artist",
      source_url: "https://example.com/song",
      source_name: "Example",
      verified_by: "seed",
      verification_note: "Verified"
    }
  ];
  const aliases = [
    {
      id: "alias_title",
      song_id: "song_a",
      alias: "Title",
      language: "en",
      alias_type: "canonical_title",
      normalized_alias: "title",
      chosung_alias: null
    },
    {
      id: "alias_display",
      song_id: "song_a",
      alias: "Display",
      language: "en",
      alias_type: "display_title",
      normalized_alias: "display",
      chosung_alias: null
    },
    {
      id: "alias_artist_translation",
      song_id: "song_a",
      alias: "아티스트",
      language: "ko",
      alias_type: "artist",
      normalized_alias: "아티스트",
      chosung_alias: "ㅇㅌㅅㅌ"
    }
  ];
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      if (statement.includes("FROM songs")) {
        return { rows: songs, rowCount: songs.length };
      }
      if (
        statement.includes("FROM song_aliases") &&
        statement.includes("alias_type = ANY")
      ) {
        return { rows: aliases, rowCount: aliases.length };
      }
      if (statement.startsWith("SELECT id FROM song_aliases")) {
        const ids = new Set((values?.[0] as readonly string[]) ?? []);
        const rows = aliases.filter((alias) => ids.has(alias.id));
        return { rows, rowCount: rows.length };
      }
      if (statement.includes("INSERT INTO song_aliases")) {
        aliases.push({
          id: values?.[0] as string,
          song_id: values?.[1] as string,
          alias: values?.[2] as string,
          language: values?.[3] as string,
          alias_type: values?.[4] as string,
          normalized_alias: values?.[5] as string,
          chosung_alias: values?.[6] as string | null
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: null };
    }
  );
  return { query, aliases };
}
