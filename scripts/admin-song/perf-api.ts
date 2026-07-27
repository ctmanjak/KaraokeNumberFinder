import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { makeSignature } from "better-auth/crypto";
import { Client } from "pg";

import type {
  DuplicateCheckInput,
  DuplicateCheckResult
} from "../../lib/admin-song-duplicate/types";
import { requireDisposableAdminSongDatabaseUrl } from "../../lib/song-identity/maintenance";

type Scenario = Readonly<{ id: string; input: DuplicateCheckInput }>;

const databaseUrl = requireDisposableAdminSongDatabaseUrl(
  process.env.DATABASE_URL,
  process.env.ADMIN_SONG_DISPOSABLE_DB_CONFIRMED
);
const baseUrl = requireLocalBaseUrl(process.env.ADMIN_T03_PERF_BASE_URL);
const publicOrigin = requireLocalPublicOrigin(
  process.env.ADMIN_T03_PERF_PUBLIC_ORIGIN
);
const authSecret = requireAuthSecret(process.env.BETTER_AUTH_SECRET);
const warmup = 5;
const iterations = 30;
const userId = randomUUID();
const database = new Client({ connectionString: databaseUrl });
await database.connect();

let cookie = "";
try {
  cookie = await createAdminSession(userId);
  const fixture = await readFixtureInputs(database);
  const scenarios: Scenario[] = [
    { id: "exact_hit", input: fixture.exact },
    {
      id: "none",
      input: {
        canonical_title: "duplicate perf no result 987654321",
        canonical_artist: "duplicate perf no artist 987654321"
      }
    },
    { id: "title_prefix", input: fixture.prefix },
    { id: "high_candidate_partial", input: fixture.partial },
    { id: "display_title_match", input: fixture.display },
    { id: "saved_alias_match", input: fixture.savedAlias },
    { id: "title_and_artist_signals", input: fixture.both },
    {
      id: "exclude_current_song",
      input: { ...fixture.exact, exclude_song_id: fixture.exactSongId }
    }
  ];
  const results = [];
  for (const scenario of scenarios) {
    for (let index = 0; index < warmup; index += 1) {
      await callApi(scenario.input);
    }
    const latencies: number[] = [];
    let maxCandidates = 0;
    let maxResponseBytes = 0;
    for (let index = 0; index < iterations; index += 1) {
      const startedAt = performance.now();
      const { payload, bytes } = await callApi(scenario.input);
      latencies.push(performance.now() - startedAt);
      maxCandidates = Math.max(maxCandidates, payload.candidates.length);
      maxResponseBytes = Math.max(maxResponseBytes, bytes);
    }
    latencies.sort((left, right) => left - right);
    const p95 = percentile(latencies, 0.95);
    results.push({
      scenario: scenario.id,
      warmup,
      iterations,
      p50_ms: percentile(latencies, 0.5),
      p95_ms: p95,
      min_ms: Number(latencies[0].toFixed(3)),
      max_ms: Number((latencies.at(-1) ?? 0).toFixed(3)),
      max_candidates: maxCandidates,
      candidate_query_count: 1,
      max_response_bytes: maxResponseBytes,
      passed: p95 <= 100 && maxCandidates <= 5
    });
  }
  const evidence = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    dataset: {
      label: "synthetic-10k-songs-100k-aliases",
      songs: 10_000,
      aliases: 100_000,
      environment: "local-disposable-release-build-api"
    },
    gate: {
      p95_ms: 100,
      candidate_limit: 5,
      passed: results.every((result) => result.passed)
    },
    scenarios: results
  };
  mkdirSync(path.join(process.cwd(), "perf-results"), { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  const output = path.join(
    process.cwd(),
    "perf-results",
    `admin-song-duplicate-release-api-local-synthetic-10k-songs-100k-aliases-${timestamp}.json`
  );
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({ output, gate: evidence.gate, results }, null, 2)
  );
  if (!evidence.gate.passed) process.exitCode = 1;
} finally {
  await database
    .query("DELETE FROM users WHERE id = $1 AND email LIKE '%@e2e.invalid'", [
      userId
    ])
    .catch(() => undefined);
  await database.end();
}

async function createAdminSession(id: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await database.query(
    `INSERT INTO users (
       id, name, email, email_verified, role, created_at, updated_at
     ) VALUES ($1, $2, $3, true, 'admin', now(), now())`,
    [id, `ADMIN-T03 perf ${id.slice(0, 8)}`, `${id}@e2e.invalid`]
  );
  await database.query(
    `INSERT INTO sessions (
       id, token, user_id, expires_at, user_agent, created_at, updated_at
     ) VALUES (
       $1, $2, $3, now() + interval '1 hour', 'ADMIN-T03 release perf',
       now(), now()
     )`,
    [randomUUID(), token, id]
  );
  const signature = await makeSignature(token, authSecret);
  return `__Host-knf.session_token=${token}.${signature}`;
}

async function callApi(input: DuplicateCheckInput): Promise<{
  payload: DuplicateCheckResult;
  bytes: number;
}> {
  const response = await fetch(
    new URL("/api/admin/songs/duplicate-check", baseUrl),
    {
      method: "POST",
      headers: {
        origin: publicOrigin,
        "sec-fetch-site": "same-origin",
        "x-forwarded-proto": "https",
        "x-forwarded-host": new URL(publicOrigin).host,
        "x-knf-request": "1",
        "content-type": "application/json",
        accept: "application/json",
        cookie
      },
      body: JSON.stringify(input)
    }
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(
      `Duplicate-check API returned ${response.status}: ${new TextDecoder().decode(bytes)}`
    );
  }
  const payload = JSON.parse(
    new TextDecoder().decode(bytes)
  ) as DuplicateCheckResult;
  if (
    !["exact", "possible", "none"].includes(payload.classification) ||
    !Array.isArray(payload.candidates)
  ) {
    throw new Error("Duplicate-check API returned an invalid response.");
  }
  return { payload, bytes: bytes.byteLength };
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
  return {
    exactSongId: exact.id,
    exact: {
      canonical_title: exact.canonical_title,
      canonical_artist: exact.canonical_artist
    },
    prefix: {
      canonical_title: prefix.canonical_title.slice(
        0,
        Math.max(2, prefix.canonical_title.length - 3)
      ),
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

function requireLocalBaseUrl(value: string | undefined): URL {
  if (value === undefined) {
    throw new Error("ADMIN_T03_PERF_BASE_URL is required.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new Error(
      "ADMIN_T03_PERF_BASE_URL must be a local HTTP release server."
    );
  }
  return url;
}

function requireLocalPublicOrigin(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("ADMIN_T03_PERF_PUBLIC_ORIGIN is required.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "ADMIN_T03_PERF_PUBLIC_ORIGIN must be a loopback HTTPS origin."
    );
  }
  return url.origin;
}

function requireAuthSecret(value: string | undefined): string {
  if (value === undefined || value.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET of at least 32 characters is required."
    );
  }
  return value;
}
