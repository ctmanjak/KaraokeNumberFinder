import { Buffer } from "node:buffer";

import { createProvidersGetHandlerForDb } from "../providers/route-handler";
import { listProviders, type ProviderDbClient } from "../providers/providers";
import { readSearchSmokeCases } from "../seed/search-smoke";
import { createSearchGetHandlerForDb } from "../search/route-handler";
import {
  parseSearchQuery,
  searchSongs,
  type SearchAliasCondition,
  type SearchDbClient
} from "../search/search";

export type PerfQueryShapeOptions = {
  dbLabel: string;
  datasetLabel: string;
  fixturePath: string;
  caseLimit: number | null;
  commit: string | null;
  branch: string | null;
  runStartedAt: string;
};

export type PerfQueryShapeDbClient = {
  $queryRaw?: SearchDbClient["$queryRaw"];
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

export type PerfQueryShapeSqlEvent = {
  query: string;
  params?: string;
  duration?: number;
  target?: string;
};

export type PerfQueryShapeSqlLog = {
  events: PerfQueryShapeSqlEvent[];
};

export type PerfQueryShapeReport = {
  schema_version: 1;
  run: {
    started_at: string;
    commit: string | null;
    branch: string | null;
    db_label: string;
    dataset_label: string;
    fixture_path: string;
    case_limit: number | null;
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
  scenarios: PerfQueryShapeScenarioReport[];
};

export type PerfQueryShapeScenarioReport = {
  id: string;
  target: "api" | "service";
  endpoint:
    "GET /api/search" | "searchSongs" | "GET /api/providers" | "listProviders";
  label: string;
  db_label: string;
  dataset_label: string;
  params: Record<string, string>;
  status: number | "ok";
  response_size_bytes: number;
  result_count: number | null;
  suggestion_count: number | null;
  client_method_count: {
    total: number;
    by_model_method: Record<string, number>;
    by_query_shape: Record<string, number>;
  };
  actual_sql_query_count: {
    available: boolean;
    total: number | null;
    by_table: Record<string, number>;
    by_query_shape: Record<string, number>;
  };
  candidate_alias_id_groups: Array<{
    query_shape: string;
    condition: unknown;
    take: number | null;
    returned: number;
    sql_query_count: number | null;
  }>;
  candidate_alias_id_group_count: number;
  candidate_alias_id_total: number;
  unique_alias_id_count: number;
  alias_detail_lookup: {
    executed: boolean;
    id_in_count: number;
    returned_alias_count: number;
    client_method_count: number;
    sql_query_count: number | null;
    sql: string[];
  };
  relation_load_observation: {
    classification:
      | "not_executed_no_candidates"
      | "sql_events_unavailable"
      | "single_join_or_prisma_join"
      | "batched_relation_load_not_n_plus_1"
      | "possible_n_plus_1"
      | "unknown";
    song_relation_sql_count: number | null;
    karaoke_entries_relation_sql_count: number | null;
    evidence: string[];
  };
  method_calls: PerfQueryShapeMethodCall[];
  sql_events: PerfQueryShapeSqlEventSummary[];
};

export type PerfQueryShapeMethodCall = {
  model_method: string;
  query_shape: string;
  args_summary: unknown;
  result_count: number;
  sql_query_count: number | null;
};

export type PerfQueryShapeSqlEventSummary = {
  index: number;
  query_shape: string;
  tables: string[];
  duration_ms: number | null;
  sql: string;
};

type SearchSmokeCase = ReturnType<typeof readSearchSmokeCases>[number];

type InstrumentedCall = {
  modelMethod: string;
  queryShape: string;
  argsSummary: unknown;
  resultCount: number;
  sqlStartIndex: number | null;
  sqlEndIndex: number | null;
};

type Scenario =
  | {
      id: string;
      target: "service" | "api";
      endpoint: "searchSongs" | "GET /api/search";
      label: string;
      params: URLSearchParams;
    }
  | {
      id: string;
      target: "service" | "api";
      endpoint: "listProviders" | "GET /api/providers";
      label: string;
      params: URLSearchParams;
    };

const MAX_CASES_PER_LABEL = 1;
const NO_RESULT_QUERY = "zzzzzzzz-no-match";
const INVALID_PROVIDER_ID = "__invalid_provider_for_perf__";

export async function runPerfQueryShape(
  db: PerfQueryShapeDbClient,
  options: PerfQueryShapeOptions,
  sqlLog?: PerfQueryShapeSqlLog
): Promise<PerfQueryShapeReport> {
  const smokeCases = representativeSmokeCases(
    readSearchSmokeCases(options.fixturePath),
    options.caseLimit
  );
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
  const reports: PerfQueryShapeScenarioReport[] = [];

  for (const scenario of scenarios) {
    reports.push(await runScenario(db, scenario, options, sqlLog));
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
      case_limit: options.caseLimit,
      node_version: process.version
    },
    dataset: {
      label: options.datasetLabel,
      current_seed_counts: counts,
      scale_scenario: "current_seed"
    },
    notes: [
      "Harness is read-only and only calls find/count APIs plus in-process route handlers.",
      "client_method_count is counted by wrapping the Prisma-facing service client methods.",
      "actual_sql_query_count is populated only when the caller provides a Prisma query event log.",
      "Prisma query event logging can distort latency and should be used for minimal query-shape runs, not timing conclusions.",
      "Nested relation SQL is classified from Prisma query events emitted during the alias detail findMany call.",
      "High-priority exact/prefix candidate lookups can overlap, while lower-priority chosung/contains lookups are staged and may be skipped when higher-ranked candidates are sufficient.",
      "dataset.label and run.db_label separate local DB, Neon DB, current seed, and future synthetic scale outputs."
    ],
    scenarios: reports
  };
}

async function readDatasetCounts(db: PerfQueryShapeDbClient) {
  const [songs, aliases, entries, providers] = await Promise.all([
    db.song.count(),
    db.songAlias.count(),
    db.karaokeEntry.count(),
    db.karaokeProvider.findMany({
      where: {},
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true }
    })
  ]);

  return {
    songs,
    song_aliases: aliases,
    karaoke_entries: entries,
    karaoke_providers: providers.length
  };
}

function representativeSmokeCases(
  smokeCases: SearchSmokeCase[],
  caseLimit: number | null
): SearchSmokeCase[] {
  const byLabel = new Map<string, number>();
  const selected: SearchSmokeCase[] = [];

  for (const smokeCase of smokeCases) {
    const label = smokeCase.label ?? smokeCase.query;
    const labelCount = byLabel.get(label) ?? 0;

    if (labelCount >= MAX_CASES_PER_LABEL) {
      continue;
    }

    byLabel.set(label, labelCount + 1);
    selected.push(smokeCase);

    if (caseLimit !== null && selected.length >= caseLimit) {
      break;
    }
  }

  return selected;
}

function buildSearchScenarios(
  smokeCases: SearchSmokeCase[],
  providerId: string | undefined
): Scenario[] {
  const scenarios: Scenario[] = [];

  for (const [index, smokeCase] of smokeCases.entries()) {
    const params = new URLSearchParams({ q: smokeCase.query });
    const scenarioId = stableScenarioId(
      smokeCase.label ?? smokeCase.query,
      index
    );

    scenarios.push({
      id: `service.search.${scenarioId}`,
      target: "service",
      endpoint: "searchSongs",
      label: smokeCase.label ?? smokeCase.query,
      params
    });
    scenarios.push({
      id: `api.search.${scenarioId}`,
      target: "api",
      endpoint: "GET /api/search",
      label: smokeCase.label ?? smokeCase.query,
      params
    });
  }

  if (providerId !== undefined && smokeCases[0] !== undefined) {
    scenarios.push({
      id: "service.search.provider-filter",
      target: "service",
      endpoint: "searchSongs",
      label: "valid provider filter",
      params: new URLSearchParams({
        q: smokeCases[0].query,
        provider_id: providerId
      })
    });
    scenarios.push({
      id: "api.search.invalid-provider",
      target: "api",
      endpoint: "GET /api/search",
      label: "invalid provider",
      params: new URLSearchParams({
        q: smokeCases[0].query,
        provider_id: INVALID_PROVIDER_ID
      })
    });
  }

  scenarios.push({
    id: "service.search.no-results-suggestions",
    target: "service",
    endpoint: "searchSongs",
    label: "no results suggestions path",
    params: new URLSearchParams({ q: NO_RESULT_QUERY })
  });
  scenarios.push({
    id: "api.search.no-results-suggestions",
    target: "api",
    endpoint: "GET /api/search",
    label: "no results suggestions path",
    params: new URLSearchParams({ q: NO_RESULT_QUERY })
  });

  return scenarios;
}

function buildProviderScenarios(country: string | undefined): Scenario[] {
  const params = new URLSearchParams({
    ...(country === undefined ? {} : { country }),
    active_only: "true"
  });

  return [
    {
      id: "service.providers.active-country",
      target: "service",
      endpoint: "listProviders",
      label: "active provider list",
      params
    },
    {
      id: "api.providers.active-country",
      target: "api",
      endpoint: "GET /api/providers",
      label: "active provider list",
      params
    }
  ];
}

async function runScenario(
  db: PerfQueryShapeDbClient,
  scenario: Scenario,
  options: PerfQueryShapeOptions,
  sqlLog: PerfQueryShapeSqlLog | undefined
): Promise<PerfQueryShapeScenarioReport> {
  if (sqlLog !== undefined) {
    sqlLog.events = [];
  }

  const calls: InstrumentedCall[] = [];
  const instrumentedDb = instrumentDb(db, calls, sqlLog);
  const result = await executeScenario(instrumentedDb, scenario);
  const sqlEvents = sqlLog?.events ?? [];
  const sqlAvailable = sqlLog !== undefined;
  const summarizedSqlEvents = sqlEvents.map(summarizeSqlEvent);
  const detailCalls = calls.filter(
    (call) =>
      call.queryShape === "song_aliases.id_in.detail_with_relations" ||
      call.queryShape === "song_aliases.raw_candidate_detail"
  );
  const detailCall = detailCalls[0];
  const detailSqlEvents = sqlForDetailCall(detailCall, summarizedSqlEvents);
  const candidateGroups = calls.filter((call) =>
    call.queryShape.startsWith("song_aliases.candidate.")
  );
  const aliasIds = new Set<string>();
  const detailAliasIds = new Set(readResultIds(detailCall?.argsSummary));

  for (const call of candidateGroups) {
    const ids = readResultIds(call.argsSummary);

    for (const id of ids) {
      aliasIds.add(id);
    }
  }

  return {
    id: scenario.id,
    target: scenario.target,
    endpoint: scenario.endpoint,
    label: scenario.label,
    db_label: options.dbLabel,
    dataset_label: options.datasetLabel,
    params: Object.fromEntries(scenario.params.entries()),
    status: result.status,
    response_size_bytes: result.responseSizeBytes,
    result_count: result.resultCount,
    suggestion_count: result.suggestionCount,
    client_method_count: summarizeClientMethodCounts(calls),
    actual_sql_query_count: summarizeSqlCounts(
      summarizedSqlEvents,
      sqlAvailable
    ),
    candidate_alias_id_groups: candidateGroups.map((call) => ({
      query_shape: call.queryShape,
      condition: readWhere(call.argsSummary),
      take: readTake(call.argsSummary),
      returned: call.resultCount,
      sql_query_count: sqlCountForCall(call, summarizedSqlEvents)
    })),
    candidate_alias_id_group_count: candidateGroups.length,
    candidate_alias_id_total: candidateGroups.reduce(
      (total, call) => total + call.resultCount,
      0
    ),
    unique_alias_id_count:
      readIdInCount(detailCall?.argsSummary) ??
      (detailAliasIds.size > 0 ? detailAliasIds.size : aliasIds.size),
    alias_detail_lookup: {
      executed: detailCall !== undefined,
      id_in_count:
        readIdInCount(detailCall?.argsSummary) ?? detailAliasIds.size,
      returned_alias_count:
        detailCall?.queryShape === "song_aliases.raw_candidate_detail"
          ? detailAliasIds.size
          : (detailCall?.resultCount ?? 0),
      client_method_count: detailCalls.length,
      sql_query_count: detailCall === undefined ? null : detailSqlEvents.length,
      sql: detailSqlEvents.map((event) => event.sql)
    },
    relation_load_observation: classifyRelationLoad(
      detailCall,
      summarizedSqlEvents,
      sqlAvailable
    ),
    method_calls: calls.map((call) => ({
      model_method: call.modelMethod,
      query_shape: call.queryShape,
      args_summary: stripResultIds(call.argsSummary),
      result_count: call.resultCount,
      sql_query_count: sqlCountForCall(call, summarizedSqlEvents)
    })),
    sql_events: summarizedSqlEvents
  };
}

async function executeScenario(
  db: SearchDbClient & ProviderDbClient,
  scenario: Scenario
) {
  if (scenario.endpoint === "searchSongs") {
    const parsed = parseSearchQuery(scenario.params);

    if (!parsed.ok) {
      return {
        status: 400 as const,
        responseSizeBytes: 0,
        resultCount: null,
        suggestionCount: null
      };
    }

    const response = await searchSongs(db, parsed.query);
    const responseSizeBytes = Buffer.byteLength(
      JSON.stringify(response),
      "utf8"
    );

    return {
      status: "ok" as const,
      responseSizeBytes,
      resultCount: response.items.length,
      suggestionCount: response.suggestions.length
    };
  }

  if (scenario.endpoint === "listProviders") {
    const providers = await listProviders(db, {
      activeOnly: scenario.params.get("active_only") !== "false",
      ...(scenario.params.get("country") === null
        ? {}
        : { country: scenario.params.get("country") as string })
    });

    return {
      status: "ok" as const,
      responseSizeBytes: Buffer.byteLength(JSON.stringify(providers), "utf8"),
      resultCount: providers.length,
      suggestionCount: null
    };
  }

  const url =
    scenario.endpoint === "GET /api/search"
      ? `http://localhost/api/search?${scenario.params.toString()}`
      : `http://localhost/api/providers?${scenario.params.toString()}`;
  const handler =
    scenario.endpoint === "GET /api/search"
      ? createSearchGetHandlerForDb(db)
      : createProvidersGetHandlerForDb(db);
  const response = await handler(new Request(url));
  const body = await response.text();
  const parsedBody = parseJsonObject(body);

  return {
    status: response.status,
    responseSizeBytes: Buffer.byteLength(body, "utf8"),
    resultCount: readResponseResultCount(parsedBody),
    suggestionCount: readResponseSuggestionCount(parsedBody)
  };
}

function instrumentDb(
  db: PerfQueryShapeDbClient,
  calls: InstrumentedCall[],
  sqlLog: PerfQueryShapeSqlLog | undefined
): SearchDbClient & ProviderDbClient {
  const queryRaw = db.$queryRaw?.bind(db);

  return {
    ...(queryRaw === undefined
      ? {}
      : {
          $queryRaw: async (query, ...values) =>
            (await recordCall(
              "$queryRaw",
              "song_aliases.raw_candidate_detail",
              { query, values },
              calls,
              sqlLog,
              async () => {
                return queryRaw<unknown[]>(query, ...values);
              }
            )) as never
        }),
    karaokeProvider: {
      findMany: async (args) =>
        (await recordCall(
          "karaokeProvider.findMany",
          classifyProviderQueryShape(args),
          args,
          calls,
          sqlLog,
          () => db.karaokeProvider.findMany(args)
        )) as never
    },
    songAlias: {
      findMany: async (args) =>
        (await recordCall(
          "songAlias.findMany",
          classifyAliasQueryShape(args),
          args,
          calls,
          sqlLog,
          () => db.songAlias.findMany(args)
        )) as never
    }
  };
}

async function recordCall(
  modelMethod: string,
  queryShape: string,
  args: unknown,
  calls: InstrumentedCall[],
  sqlLog: PerfQueryShapeSqlLog | undefined,
  execute: () => Promise<unknown[]>
): Promise<unknown[]> {
  const sqlStartIndex = sqlLog?.events.length ?? null;
  const result = await execute();
  const sqlEndIndex = sqlLog?.events.length ?? null;

  calls.push({
    modelMethod,
    queryShape,
    argsSummary: { ...summarizeArgs(args), __result_ids: resultIds(result) },
    resultCount: result.length,
    sqlStartIndex,
    sqlEndIndex
  });

  return result;
}

function classifyProviderQueryShape(args: unknown): string {
  const select = readSelect(args);

  if (hasOnlyKeys(select, ["id", "isActive", "isDefault"])) {
    return "karaoke_providers.active_for_search";
  }

  return "karaoke_providers.providers_list";
}

function classifyAliasQueryShape(args: unknown): string {
  const where = readWhere(args);
  const select = readSelect(args);

  if (isRecord(where) && "id" in where) {
    return "song_aliases.id_in.detail_with_relations";
  }

  if (isRecord(where) && "OR" in where) {
    return "song_aliases.suggestions";
  }

  if (hasOnlyKeys(select, ["id"])) {
    return `song_aliases.candidate.${conditionShape(where)}`;
  }

  return "song_aliases.unknown";
}

function conditionShape(where: unknown): string {
  if (!isRecord(where)) {
    return "unknown";
  }

  const normalizedAlias = where.normalizedAlias;

  if (isRecord(normalizedAlias)) {
    if ("equals" in normalizedAlias) {
      return "normalized_alias.equals";
    }

    if ("startsWith" in normalizedAlias) {
      return "normalized_alias.starts_with";
    }

    if ("contains" in normalizedAlias) {
      return "normalized_alias.contains";
    }
  }

  if ("chosungAlias" in where) {
    return "chosung_alias.starts_with";
  }

  return "unknown";
}

function summarizeClientMethodCounts(calls: InstrumentedCall[]) {
  return {
    total: calls.length,
    by_model_method: countBy(calls.map((call) => call.modelMethod)),
    by_query_shape: countBy(calls.map((call) => call.queryShape))
  };
}

function summarizeSqlCounts(
  events: PerfQueryShapeSqlEventSummary[],
  available: boolean
) {
  return {
    available,
    total: available ? events.length : null,
    by_table: countBy(events.flatMap((event) => event.tables)),
    by_query_shape: countBy(events.map((event) => event.query_shape))
  };
}

function classifyRelationLoad(
  detailCall: InstrumentedCall | undefined,
  events: PerfQueryShapeSqlEventSummary[],
  sqlAvailable: boolean
): PerfQueryShapeScenarioReport["relation_load_observation"] {
  if (detailCall === undefined) {
    return {
      classification: "not_executed_no_candidates",
      song_relation_sql_count: null,
      karaoke_entries_relation_sql_count: null,
      evidence: [
        "No alias detail lookup executed because candidate IDs were empty."
      ]
    };
  }

  if (
    !sqlAvailable ||
    detailCall.sqlStartIndex === null ||
    detailCall.sqlEndIndex === null
  ) {
    return {
      classification: "sql_events_unavailable",
      song_relation_sql_count: null,
      karaoke_entries_relation_sql_count: null,
      evidence: ["Prisma query events were not available for this run."]
    };
  }

  const detailEvents = sqlForDetailCall(detailCall, events);
  const songSqlCount = detailEvents.filter((event) =>
    event.tables.includes("songs")
  ).length;
  const karaokeEntriesSqlCount = detailEvents.filter((event) =>
    event.tables.includes("karaoke_entries")
  ).length;
  const hasJoin = detailEvents.some((event) => /\bjoin\b/iu.test(event.sql));
  const classification =
    detailEvents.length === 1 && hasJoin
      ? "single_join_or_prisma_join"
      : songSqlCount <= 1 && karaokeEntriesSqlCount <= 1
        ? "batched_relation_load_not_n_plus_1"
        : "possible_n_plus_1";

  return {
    classification,
    song_relation_sql_count: songSqlCount,
    karaoke_entries_relation_sql_count: karaokeEntriesSqlCount,
    evidence: [
      `Alias detail Prisma method call emitted ${detailEvents.length} SQL event(s).`,
      `SQL touching songs: ${songSqlCount}. SQL touching karaoke_entries: ${karaokeEntriesSqlCount}.`,
      hasJoin
        ? "At least one detail SQL event contains JOIN."
        : "No JOIN keyword observed in detail SQL events."
    ]
  };
}

function summarizeSqlEvent(
  event: PerfQueryShapeSqlEvent,
  index: number
): PerfQueryShapeSqlEventSummary {
  const sql = normalizeSql(event.query);
  const tables = tablesForSql(sql);

  return {
    index,
    query_shape: sqlShape(sql, tables),
    tables,
    duration_ms: event.duration ?? null,
    sql
  };
}

function sqlShape(sql: string, tables: string[]): string {
  if (tables.includes("karaoke_providers")) {
    return "karaoke_providers.select";
  }

  if (tables.includes("song_aliases") && tables.includes("songs")) {
    return "song_aliases.detail_with_song_relation";
  }

  if (tables.includes("song_aliases")) {
    return "song_aliases.select";
  }

  if (tables.includes("karaoke_entries")) {
    return "karaoke_entries.relation_select";
  }

  if (tables.includes("songs")) {
    return "songs.relation_select";
  }

  return "unknown";
}

function tablesForSql(sql: string): string[] {
  return [
    "song_aliases",
    "songs",
    "karaoke_entries",
    "karaoke_providers"
  ].filter((table) => sql.includes(table));
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function sqlCountForCall(
  call: InstrumentedCall,
  events?: PerfQueryShapeSqlEventSummary[]
): number | null {
  if (call.queryShape.startsWith("song_aliases.candidate.")) {
    return null;
  }

  if (events !== undefined) {
    if (call.queryShape === "song_aliases.raw_candidate_detail") {
      return rawCandidateDetailSqlEvents(events).length;
    }

    if (call.queryShape.startsWith("karaoke_providers.")) {
      return events.filter(
        (event) => event.query_shape === "karaoke_providers.select"
      ).length;
    }
  }

  if (call.sqlStartIndex === null || call.sqlEndIndex === null) {
    return null;
  }

  return call.sqlEndIndex - call.sqlStartIndex;
}

function sqlForCall(
  call: InstrumentedCall,
  events: PerfQueryShapeSqlEventSummary[]
): PerfQueryShapeSqlEventSummary[] {
  if (call.sqlStartIndex === null || call.sqlEndIndex === null) {
    return [];
  }

  return events.slice(call.sqlStartIndex, call.sqlEndIndex);
}

function sqlForDetailCall(
  call: InstrumentedCall | undefined,
  events: PerfQueryShapeSqlEventSummary[]
): PerfQueryShapeSqlEventSummary[] {
  if (call === undefined) {
    return [];
  }

  if (call.queryShape === "song_aliases.raw_candidate_detail") {
    return rawCandidateDetailSqlEvents(events);
  }

  return sqlForCall(call, events);
}

function rawCandidateDetailSqlEvents(
  events: PerfQueryShapeSqlEventSummary[]
): PerfQueryShapeSqlEventSummary[] {
  return events.filter(
    (event) => event.query_shape === "song_aliases.detail_with_song_relation"
  );
}

function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) {
    return {};
  }

  return {
    where: args.where,
    select: args.select,
    orderBy: args.orderBy,
    take: args.take
  };
}

function stripResultIds(argsSummary: unknown): unknown {
  if (!isRecord(argsSummary)) {
    return argsSummary;
  }

  const rest = { ...argsSummary };
  delete rest.__result_ids;

  return rest;
}

function readResultIds(argsSummary: unknown): string[] {
  if (!isRecord(argsSummary) || !Array.isArray(argsSummary.__result_ids)) {
    return [];
  }

  return argsSummary.__result_ids.filter(
    (value): value is string => typeof value === "string"
  );
}

function resultIds(result: unknown[]): string[] {
  return result
    .map((row) => {
      if (!isRecord(row)) {
        return null;
      }

      if (typeof row.id === "string") {
        return row.id;
      }

      return typeof row.alias_id === "string" ? row.alias_id : null;
    })
    .filter((value): value is string => value !== null);
}

function readWhere(args: unknown): unknown {
  return isRecord(args) ? args.where : undefined;
}

function readSelect(args: unknown): unknown {
  return isRecord(args) ? args.select : undefined;
}

function readTake(args: unknown): number | null {
  return isRecord(args) && typeof args.take === "number" ? args.take : null;
}

function readIdInCount(args: unknown): number | null {
  const where = readWhere(args);

  if (!isRecord(where) || !isRecord(where.id) || !Array.isArray(where.id.in)) {
    return null;
  }

  return where.id.in.length;
}

function readResponseResultCount(body: unknown): number | null {
  if (isRecord(body) && Array.isArray(body.items)) {
    return body.items.length;
  }

  return null;
}

function readResponseSuggestionCount(body: unknown): number | null {
  if (isRecord(body) && Array.isArray(body.suggestions)) {
    return body.suggestions.length;
  }

  return null;
}

function parseJsonObject(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function hasOnlyKeys(value: unknown, keys: string[]): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();

  return (
    actualKeys.length === keys.length &&
    keys.every((key, index) => actualKeys[index] === key)
  );
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function stableScenarioId(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return `${slug || "case"}-${String(index + 1).padStart(2, "0")}`;
}

function asProviderDbClient(db: PerfQueryShapeDbClient): ProviderDbClient {
  return {
    karaokeProvider: {
      findMany: async (args) =>
        (await db.karaokeProvider.findMany(args)) as never
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function queryShapeCandidateConditionShape(
  condition: SearchAliasCondition
): string {
  return conditionShape(condition);
}
