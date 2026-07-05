import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";

import { createProvidersGetHandlerForDb } from "../providers/route-handler";
import {
  listProviders,
  parseProviderListQuery,
  type ProviderDbClient
} from "../providers/providers";
import { readSearchSmokeCases } from "../seed/search-smoke";
import { createSearchGetHandlerForDb } from "../search/route-handler";
import {
  parseSearchQuery,
  searchSongs,
  type SearchDbClient
} from "../search/search";

export type PerfBaselineOptions = {
  dbLabel: string;
  datasetLabel: string;
  fixturePath: string;
  iterations: number;
  warmup: number;
  commit: string | null;
  branch: string | null;
  runStartedAt: string;
};

export type PerfBaselineDbClient = {
  karaokeProvider: {
    findMany(args: unknown): Promise<unknown[]>;
  };
  songAlias: {
    findMany(args: unknown): Promise<unknown[]>;
    count(): Promise<number>;
  };
  song: {
    count(): Promise<number>;
  };
  karaokeEntry: {
    count(): Promise<number>;
  };
};

export type PerfBaselineReport = {
  schema_version: 1;
  run: {
    started_at: string;
    commit: string | null;
    branch: string | null;
    db_label: string;
    dataset_label: string;
    fixture_path: string;
    iterations: number;
    warmup: number;
    node_version: string;
  };
  dataset: {
    label: string;
    current_seed_counts: {
      songs: number;
      song_aliases: number;
      karaoke_entries: number;
      karaoke_providers: number;
    };
    scale_scenario: "current_seed" | "synthetic_future";
  };
  notes: string[];
  scenarios: PerfScenarioReport[];
};

export type PerfScenarioReport = {
  id: string;
  target: "api" | "service";
  endpoint:
    "GET /api/search" | "GET /api/providers" | "searchSongs" | "listProviders";
  dataset_label: string;
  db_label: string;
  label: string;
  query?: string;
  expected_song_id?: string;
  params: Record<string, string>;
  status: number | "ok";
  iterations: number;
  warmup: number;
  latency_ms: PercentileSummary;
  total_request_time_ms: number;
  query_count: PercentileSummary;
  response_size_bytes: PercentileSummary;
};

export type PercentileSummary = {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
};

type MeasuredIteration = {
  latencyMs: number;
  queryCount: number;
  responseSizeBytes: number;
  status: number | "ok";
};

type QueryCounter = {
  reset(): void;
  value(): number;
  increment(): void;
};

type SearchSmokeCase = ReturnType<typeof readSearchSmokeCases>[number];

const MAX_CASES_PER_LABEL = 1;

export async function runPerfBaseline(
  db: PerfBaselineDbClient,
  options: PerfBaselineOptions
): Promise<PerfBaselineReport> {
  const smokeCases = readSearchSmokeCases(options.fixturePath);
  const providers = await listProviders(asProviderDbClient(db), {
    activeOnly: true
  });
  const allProviders = await listProviders(asProviderDbClient(db), {
    activeOnly: false
  });
  const counts = await readDatasetCounts(db);
  const scenarios = [
    ...buildSearchScenarios(smokeCases, providers[0]?.id),
    ...buildProviderScenarios(allProviders[0]?.country)
  ];
  const reports: PerfScenarioReport[] = [];

  for (const scenario of scenarios) {
    reports.push(await runScenario(db, scenario, options));
  }

  return {
    schema_version: 1,
    run: {
      started_at: options.runStartedAt,
      commit: options.commit,
      branch: options.branch,
      db_label: options.dbLabel,
      dataset_label: options.datasetLabel,
      fixture_path: options.fixturePath,
      iterations: options.iterations,
      warmup: options.warmup,
      node_version: process.version
    },
    dataset: {
      label: options.datasetLabel,
      current_seed_counts: counts,
      scale_scenario: "current_seed"
    },
    notes: [
      "Harness is read-only and only calls find/count APIs.",
      "Query count is counted at the Prisma client wrapper call level, not by enabling Prisma SQL query logging.",
      "Nested relation loads may map to more than one SQL statement depending on Prisma internals; use later EXPLAIN/query-shape tickets for SQL-level detail.",
      "API scenarios execute route handlers with Request/Response objects in-process; they include route parsing and JSON serialization but not Next.js dev server or network overhead.",
      "dataset.scale_scenario distinguishes current seed measurements from future synthetic scale runs."
    ],
    scenarios: reports
  };
}

async function readDatasetCounts(db: PerfBaselineDbClient) {
  const [songs, songAliases, karaokeEntries, karaokeProviders] =
    await Promise.all([
      db.song.count(),
      db.songAlias.count(),
      db.karaokeEntry.count(),
      db.karaokeProvider.findMany({
        where: {},
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          country: true,
          isActive: true,
          displayOrder: true,
          isDefault: true,
          lastCatalogUpdatedAt: true
        }
      })
    ]);

  return {
    songs,
    song_aliases: songAliases,
    karaoke_entries: karaokeEntries,
    karaoke_providers: karaokeProviders.length
  };
}

type PerfScenario =
  | {
      id: string;
      target: "service" | "api";
      endpoint: "searchSongs" | "GET /api/search";
      smokeCase: SearchSmokeCase;
      params: URLSearchParams;
    }
  | {
      id: string;
      target: "service" | "api";
      endpoint: "listProviders" | "GET /api/providers";
      label: string;
      params: URLSearchParams;
    };

function buildSearchScenarios(
  smokeCases: SearchSmokeCase[],
  providerId: string | undefined
): PerfScenario[] {
  const representativeCases = dedupeSmokeCasesByLabel(smokeCases);
  const scenarios: PerfScenario[] = [];

  for (const smokeCase of representativeCases) {
    const params = new URLSearchParams({ q: smokeCase.query });

    scenarios.push({
      id: `service.search.${slug(smokeCase.label ?? smokeCase.query)}`,
      target: "service",
      endpoint: "searchSongs",
      smokeCase,
      params
    });
    scenarios.push({
      id: `api.search.${slug(smokeCase.label ?? smokeCase.query)}`,
      target: "api",
      endpoint: "GET /api/search",
      smokeCase,
      params
    });
  }

  if (providerId !== undefined && representativeCases[0] !== undefined) {
    const smokeCase = representativeCases[0];
    const params = new URLSearchParams({
      q: smokeCase.query,
      provider_id: providerId
    });

    scenarios.push({
      id: "service.search.provider-filter",
      target: "service",
      endpoint: "searchSongs",
      smokeCase,
      params
    });
    scenarios.push({
      id: "api.search.provider-filter",
      target: "api",
      endpoint: "GET /api/search",
      smokeCase,
      params
    });
  }

  if (representativeCases[0] !== undefined) {
    const smokeCase = representativeCases[0];

    scenarios.push({
      id: "api.search.invalid-provider",
      target: "api",
      endpoint: "GET /api/search",
      smokeCase,
      params: new URLSearchParams({
        q: smokeCase.query,
        provider_id: "__perf_missing_provider__"
      })
    });
  }

  return scenarios;
}

function buildProviderScenarios(country: string | undefined): PerfScenario[] {
  const scenarios: PerfScenario[] = [
    {
      id: "service.providers.active",
      target: "service",
      endpoint: "listProviders",
      label: "active providers",
      params: new URLSearchParams()
    },
    {
      id: "api.providers.active",
      target: "api",
      endpoint: "GET /api/providers",
      label: "active providers",
      params: new URLSearchParams()
    },
    {
      id: "service.providers.all",
      target: "service",
      endpoint: "listProviders",
      label: "all providers",
      params: new URLSearchParams({ active_only: "false" })
    },
    {
      id: "api.providers.all",
      target: "api",
      endpoint: "GET /api/providers",
      label: "all providers",
      params: new URLSearchParams({ active_only: "false" })
    }
  ];

  if (country !== undefined) {
    scenarios.push(
      {
        id: "service.providers.country",
        target: "service",
        endpoint: "listProviders",
        label: `country ${country}`,
        params: new URLSearchParams({ country })
      },
      {
        id: "api.providers.country",
        target: "api",
        endpoint: "GET /api/providers",
        label: `country ${country}`,
        params: new URLSearchParams({ country })
      }
    );
  }

  return scenarios;
}

function dedupeSmokeCasesByLabel(
  smokeCases: SearchSmokeCase[]
): SearchSmokeCase[] {
  const seen = new Map<string, number>();
  const selected: SearchSmokeCase[] = [];

  for (const smokeCase of smokeCases) {
    const key = smokeCase.label ?? smokeCase.query;
    const count = seen.get(key) ?? 0;

    if (count < MAX_CASES_PER_LABEL) {
      selected.push(smokeCase);
    }

    seen.set(key, count + 1);
  }

  return selected;
}

async function runScenario(
  db: PerfBaselineDbClient,
  scenario: PerfScenario,
  options: PerfBaselineOptions
): Promise<PerfScenarioReport> {
  const measured: MeasuredIteration[] = [];
  const totalRuns = options.warmup + options.iterations;

  for (let index = 0; index < totalRuns; index += 1) {
    const result = await runMeasuredIteration(db, scenario);

    if (index >= options.warmup) {
      measured.push(result);
    }
  }

  const query = "smokeCase" in scenario ? scenario.smokeCase.query : undefined;
  const label =
    "smokeCase" in scenario
      ? (scenario.smokeCase.label ?? scenario.smokeCase.query)
      : scenario.label;

  return {
    id: scenario.id,
    target: scenario.target,
    endpoint: scenario.endpoint,
    dataset_label: options.datasetLabel,
    db_label: options.dbLabel,
    label,
    ...(query === undefined ? {} : { query }),
    ...("smokeCase" in scenario
      ? { expected_song_id: scenario.smokeCase.expectedSongId }
      : {}),
    params: Object.fromEntries(scenario.params.entries()),
    status: measured[measured.length - 1]?.status ?? "ok",
    iterations: options.iterations,
    warmup: options.warmup,
    latency_ms: summarize(measured.map((item) => item.latencyMs)),
    total_request_time_ms: round(
      measured.reduce((sum, item) => sum + item.latencyMs, 0)
    ),
    query_count: summarize(measured.map((item) => item.queryCount)),
    response_size_bytes: summarize(
      measured.map((item) => item.responseSizeBytes)
    )
  };
}

async function runMeasuredIteration(
  db: PerfBaselineDbClient,
  scenario: PerfScenario
): Promise<MeasuredIteration> {
  const counter = createQueryCounter();
  const countedDb = createCountingDbClient(db, counter);
  const startedAt = performance.now();
  let responseSizeBytes = 0;
  let status: number | "ok" = "ok";

  if (scenario.endpoint === "searchSongs") {
    const parsed = parseSearchQuery(scenario.params);

    if (!parsed.ok) {
      throw new Error(`invalid perf search scenario: ${scenario.id}`);
    }

    const body = await searchSongs(asSearchDbClient(countedDb), parsed.query);
    responseSizeBytes = byteLength(body);
  } else if (scenario.endpoint === "listProviders") {
    const parsed = parseProviderListQuery(scenario.params);

    if (!parsed.ok) {
      throw new Error(`invalid perf providers scenario: ${scenario.id}`);
    }

    const body = await listProviders(
      asProviderDbClient(countedDb),
      parsed.query
    );
    responseSizeBytes = byteLength({ items: body });
  } else if (scenario.endpoint === "GET /api/search") {
    const handler = createSearchGetHandlerForDb(asSearchDbClient(countedDb));
    const response = await handler(requestFor("/api/search", scenario.params));
    const text = await response.text();
    status = response.status;
    responseSizeBytes = Buffer.byteLength(text, "utf8");
  } else {
    const handler = createProvidersGetHandlerForDb(
      asProviderDbClient(countedDb)
    );
    const response = await handler(
      requestFor("/api/providers", scenario.params)
    );
    const text = await response.text();
    status = response.status;
    responseSizeBytes = Buffer.byteLength(text, "utf8");
  }

  return {
    latencyMs: performance.now() - startedAt,
    queryCount: counter.value(),
    responseSizeBytes,
    status
  };
}

function createCountingDbClient(
  db: PerfBaselineDbClient,
  counter: QueryCounter
): PerfBaselineDbClient {
  return {
    ...db,
    karaokeProvider: {
      ...db.karaokeProvider,
      findMany: (args) => {
        counter.increment();
        return db.karaokeProvider.findMany(args);
      }
    },
    songAlias: {
      ...db.songAlias,
      findMany: (args) => {
        counter.increment();
        return db.songAlias.findMany(args);
      },
      count: () => db.songAlias.count()
    },
    song: db.song,
    karaokeEntry: db.karaokeEntry
  };
}

function asSearchDbClient(db: PerfBaselineDbClient): SearchDbClient {
  return db as unknown as SearchDbClient;
}

function asProviderDbClient(db: PerfBaselineDbClient): ProviderDbClient {
  return db as unknown as ProviderDbClient;
}

function createQueryCounter(): QueryCounter {
  let queryCount = 0;

  return {
    reset: () => {
      queryCount = 0;
    },
    value: () => queryCount,
    increment: () => {
      queryCount += 1;
    }
  };
}

function requestFor(pathname: string, params: URLSearchParams): Request {
  const url = new URL(`http://localhost${pathname}`);
  url.search = params.toString();

  return new Request(url);
}

function byteLength(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

function summarize(values: number[]): PercentileSummary {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    min: round(sorted[0] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    avg: round(sum / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95))
  };
}

function percentile(sortedValues: number[], percentileValue: number): number {
  const index = Math.max(
    0,
    Math.ceil(sortedValues.length * percentileValue) - 1
  );

  return sortedValues[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
}
