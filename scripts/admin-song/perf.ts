import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { findDuplicateCandidates } from "../../lib/admin-song-duplicate/repository";
import { normalizeDuplicateInput } from "../../lib/admin-song-duplicate/match";
import type { DuplicateCheckInput } from "../../lib/admin-song-duplicate/types";
import { requireDisposableAdminSongDatabaseUrl } from "../../lib/song-identity/maintenance";

type Scenario = {
  id: string;
  input: DuplicateCheckInput;
};

const databaseUrl = requireDisposableAdminSongDatabaseUrl(
  process.env.DATABASE_URL,
  process.env.ADMIN_SONG_DISPOSABLE_DB_CONFIRMED
);
const warmup = 5;
const iterations = 30;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, max: 5 })
});
const pg = new Client({ connectionString: databaseUrl });
await pg.connect();
try {
  const fixture = await readFixtureInputs(pg);
  const scenarios: Scenario[] = [
    {
      id: "exact_hit",
      input: fixture.exact
    },
    {
      id: "none",
      input: {
        canonical_title: "duplicate perf no result 987654321",
        canonical_artist: "duplicate perf no artist 987654321"
      }
    },
    {
      id: "title_prefix",
      input: fixture.prefix
    },
    {
      id: "high_candidate_partial",
      input: fixture.partial
    },
    {
      id: "display_title_match",
      input: fixture.display
    },
    {
      id: "saved_alias_match",
      input: fixture.savedAlias
    },
    {
      id: "title_and_artist_signals",
      input: fixture.both
    },
    {
      id: "exclude_current_song",
      input: {
        ...fixture.exact,
        exclude_song_id: fixture.exactSongId
      }
    }
  ];
  const results = [];
  for (const scenario of scenarios) {
    for (let index = 0; index < warmup; index += 1) {
      await findDuplicateCandidates(prisma, scenario.input);
    }
    const latency: number[] = [];
    let maxCandidates = 0;
    let maxResponseBytes = 0;
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      const response = await findDuplicateCandidates(prisma, scenario.input);
      latency.push(performance.now() - started);
      maxCandidates = Math.max(maxCandidates, response.candidates.length);
      maxResponseBytes = Math.max(
        maxResponseBytes,
        Buffer.byteLength(JSON.stringify(response), "utf8")
      );
    }
    latency.sort((left, right) => left - right);
    results.push({
      scenario: scenario.id,
      warmup,
      iterations,
      p50_ms: percentile(latency, 0.5),
      p95_ms: percentile(latency, 0.95),
      min_ms: latency[0],
      max_ms: latency.at(-1),
      max_candidates: maxCandidates,
      candidate_query_count: 1,
      max_response_bytes: maxResponseBytes,
      passed: percentile(latency, 0.95) <= 100 && maxCandidates <= 5
    });
  }
  const explain = await explainWorstPartial(pg, fixture.partial);
  const evidence = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    dataset: {
      label: "synthetic-10k-songs-100k-aliases",
      songs: 10_000,
      aliases: 100_000,
      environment: "local-disposable"
    },
    gate: {
      p95_ms: 100,
      candidate_limit: 5,
      passed: results.every((result) => result.passed)
    },
    scenarios: results,
    worst_partial_explain: explain.rows.map((row) => row["QUERY PLAN"])
  };
  mkdirSync(path.join(process.cwd(), "perf-results"), { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  const output = path.join(
    process.cwd(),
    "perf-results",
    `admin-song-duplicate-local-synthetic-10k-songs-100k-aliases-${timestamp}.json`
  );
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({ output, gate: evidence.gate, results }, null, 2)
  );
  if (!evidence.gate.passed) process.exitCode = 1;
} finally {
  await Promise.all([prisma.$disconnect(), pg.end()]);
}

async function readFixtureInputs(client: Client) {
  const rows = await client.query<{
    id: string;
    canonical_title: string;
    display_title: string;
    canonical_artist: string;
  }>(`
    SELECT id, canonical_title, display_title, canonical_artist
    FROM songs
    WHERE id IN (
      'synthetic_10k_song_000001',
      'synthetic_10k_song_000002',
      'synthetic_10k_song_000003',
      'synthetic_10k_song_000007'
    )
    ORDER BY id ASC
  `);
  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  const exact = required(byId, "synthetic_10k_song_000001");
  const prefix = required(byId, "synthetic_10k_song_000002");
  const saved = required(byId, "synthetic_10k_song_000003");
  const partial = required(byId, "synthetic_10k_song_000007");
  const savedAlias = await client.query<{ alias: string }>(`
    SELECT alias
    FROM song_aliases
    WHERE song_id = 'synthetic_10k_song_000003'
      AND alias_type = 'romanized_title'
    LIMIT 1
  `);
  const prefixTitle = prefix.canonical_title.slice(
    0,
    Math.max(2, prefix.canonical_title.length - 3)
  );
  return {
    exactSongId: exact.id,
    exact: {
      canonical_title: exact.canonical_title,
      canonical_artist: exact.canonical_artist
    },
    prefix: {
      canonical_title: prefixTitle,
      canonical_artist: prefix.canonical_artist
    },
    partial: {
      canonical_title: "star",
      canonical_artist: partial.canonical_artist
    },
    display: {
      canonical_title: exact.display_title,
      display_title: exact.display_title,
      canonical_artist: exact.canonical_artist
    },
    savedAlias: {
      canonical_title: savedAlias.rows[0].alias,
      canonical_artist: saved.canonical_artist
    },
    both: {
      canonical_title: saved.canonical_title,
      display_title: saved.display_title,
      canonical_artist: saved.canonical_artist
    }
  };
}

function required<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing perf fixture ${key}.`);
  return value;
}

function percentile(values: readonly number[], value: number): number {
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * value) - 1)
  );
  return Number(values[index].toFixed(3));
}

async function explainWorstPartial(client: Client, input: DuplicateCheckInput) {
  const normalized = normalizeDuplicateInput(input);
  const matchInputs = JSON.stringify([
    ...normalized.titles.map((title) => ({
      role: "title",
      value: title.value,
      input_field: title.inputField
    })),
    {
      role: "artist",
      value: normalized.canonicalArtist,
      input_field: "canonical_artist"
    }
  ]);
  return client.query<{ "QUERY PLAN": string }>(
    `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      WITH input_values AS (
        SELECT role, value, input_field
        FROM jsonb_to_recordset($1::jsonb)
          AS input(role text, value text, input_field text)
      ),
      candidate_values AS (
        SELECT
          song.id AS song_id,
          'title'::text AS role,
          song.normalized_canonical_title AS normalized_value,
          'song.canonical_title'::text AS candidate_field,
          song.canonical_title AS matched_value
        FROM songs AS song
        UNION ALL
        SELECT
          song.id,
          'artist',
          song.normalized_canonical_artist,
          'song.canonical_artist',
          song.canonical_artist
        FROM songs AS song
        UNION ALL
        SELECT
          alias.song_id,
          CASE WHEN alias.alias_type = 'artist'
               THEN 'artist' ELSE 'title' END,
          alias.normalized_alias,
          'alias.' || alias.alias_type::text,
          alias.alias
        FROM song_aliases AS alias
        JOIN songs AS alias_song ON alias_song.id = alias.song_id
        WHERE alias.alias_type IN (
          'canonical_title', 'display_title', 'romanized_title',
          'english_title', 'translated_title', 'abbreviation',
          'common_name', 'alternate_spelling', 'artist'
        )
          AND (
            alias.alias_type <> 'artist'
            OR alias.normalized_alias = alias_song.normalized_canonical_artist
          )
      ),
      scored_values AS (
        SELECT
          candidate.song_id,
          candidate.role,
          input.input_field,
          candidate.candidate_field,
          candidate.matched_value,
          CASE
            WHEN candidate.normalized_value = input.value THEN 3
            WHEN char_length(input.value) >= 2
              AND candidate.normalized_value LIKE input.value || '%' THEN 2
            ELSE 1
          END AS strength
        FROM candidate_values AS candidate
        JOIN input_values AS input
          ON input.role = candidate.role
         AND (
           candidate.normalized_value = input.value
           OR (
             char_length(input.value) >= 2
             AND candidate.normalized_value LIKE input.value || '%'
           )
           OR (
             char_length(input.value) >= 2
             AND candidate.normalized_value LIKE '%' || input.value || '%'
           )
         )
      ),
      best_values AS (
        SELECT DISTINCT ON (song_id, role)
          song_id, role, strength, input_field, candidate_field, matched_value
        FROM scored_values
        ORDER BY song_id ASC, role ASC, strength DESC, input_field ASC,
                 candidate_field ASC, matched_value ASC
      ),
      best_title AS (
        SELECT song_id, strength
        FROM best_values
        WHERE role = 'title'
      ),
      best_artist AS (
        SELECT song_id, strength
        FROM best_values
        WHERE role = 'artist'
      )
      SELECT song.id
      FROM songs AS song
      LEFT JOIN best_title AS title ON title.song_id = song.id
      LEFT JOIN best_artist AS artist ON artist.song_id = song.id
      WHERE title.song_id IS NOT NULL OR artist.song_id IS NOT NULL
      ORDER BY
        (
          song.normalized_canonical_title = $2
          AND song.normalized_canonical_artist = $3
        ) DESC,
        (title.strength IS NOT NULL AND artist.strength IS NOT NULL) DESC,
        COALESCE(title.strength, 0) DESC,
        COALESCE(artist.strength, 0) DESC,
        song.id ASC
      LIMIT 5
    `,
    [matchInputs, normalized.canonicalTitle, normalized.canonicalArtist]
  );
}
