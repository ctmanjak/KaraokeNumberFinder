import { Client } from "pg";
import { buildAliasSearchFields } from "../../lib/search/normalize";
import { normalizeSongIdentity } from "../../lib/song-identity/normalize";
import { requireDisposableAdminSongDatabaseUrl } from "../../lib/song-identity/maintenance";

type SongRow = {
  id: string;
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
};

type AliasRow = {
  id: string;
  song_id: string;
  alias_type: "canonical_title" | "display_title" | "artist";
};

const databaseUrl = requireDisposableAdminSongDatabaseUrl(
  process.env.DATABASE_URL,
  process.env.ADMIN_SONG_DISPOSABLE_DB_CONFIRMED
);
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const songs = await client.query<SongRow>(`
    SELECT id, original_language, canonical_title, display_title,
           canonical_artist
    FROM songs
    ORDER BY id ASC
  `);
  const aliases = await client.query<AliasRow>(`
    SELECT id, song_id, alias_type
    FROM song_aliases
    WHERE alias_type IN ('canonical_title', 'display_title', 'artist')
    ORDER BY song_id ASC, alias_type ASC, id ASC
  `);
  const aliasCounts = new Map<string, number>();
  for (const alias of aliases.rows) {
    const key = `${alias.song_id}\u0000${alias.alias_type}`;
    aliasCounts.set(key, (aliasCounts.get(key) ?? 0) + 1);
  }
  for (const song of songs.rows) {
    for (const type of [
      "canonical_title",
      "display_title",
      "artist"
    ] as const) {
      if ((aliasCounts.get(`${song.id}\u0000${type}`) ?? 0) !== 1) {
        throw new Error(
          `Synthetic fixture ${song.id} must have exactly one ${type} row.`
        );
      }
    }
  }
  const songById = new Map(songs.rows.map((song) => [song.id, song]));
  await client.query("BEGIN");
  try {
    for (const batch of batches(songs.rows, 500)) {
      const ids: string[] = [];
      const titles: string[] = [];
      const artists: string[] = [];
      for (const song of batch) {
        const identity = normalizeSongIdentity(song);
        ids.push(song.id);
        titles.push(identity.normalizedCanonicalTitle);
        artists.push(identity.normalizedCanonicalArtist);
      }
      await client.query(
        `
          UPDATE songs AS song
          SET normalized_canonical_title = input.title,
              normalized_canonical_artist = input.artist
          FROM unnest($1::text[], $2::text[], $3::text[])
            AS input(id, title, artist)
          WHERE song.id = input.id
        `,
        [ids, titles, artists]
      );
    }
    for (const batch of batches(aliases.rows, 500)) {
      const ids: string[] = [];
      const values: string[] = [];
      const normalized: string[] = [];
      const chosung: Array<string | null> = [];
      const languages: string[] = [];
      for (const alias of batch) {
        const song = songById.get(alias.song_id);
        if (song === undefined) throw new Error("Synthetic song is missing.");
        const value =
          alias.alias_type === "canonical_title"
            ? song.canonical_title
            : alias.alias_type === "display_title"
              ? song.display_title
              : song.canonical_artist;
        const search = buildAliasSearchFields(value);
        ids.push(alias.id);
        values.push(value);
        normalized.push(search.normalizedAlias);
        chosung.push(search.chosungAlias || null);
        languages.push(song.original_language);
      }
      await client.query(
        `
          UPDATE song_aliases AS alias
          SET alias = input.value,
              normalized_alias = input.normalized,
              chosung_alias = input.chosung,
              language = input.language
          FROM unnest(
            $1::text[], $2::text[], $3::text[], $4::text[], $5::text[]
          ) AS input(id, value, normalized, chosung, language)
          WHERE alias.id = input.id
        `,
        [ids, values, normalized, chosung, languages]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  console.log(
    JSON.stringify({
      prepared: true,
      songs: songs.rows.length,
      aliases: aliases.rows.length
    })
  );
} finally {
  await client.end();
}

function batches<T>(rows: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}
