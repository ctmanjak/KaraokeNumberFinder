import { readSearchSmokeCases } from "../seed/search-smoke";
import {
  canUseHangulChosungSearch,
  normalizeChosungQuery,
  normalizeSearchText
} from "../search/normalize";

export type PerfExplainOptions = {
  dbLabel: string;
  datasetLabel: string;
  fixturePath: string;
  caseLimit: number | null;
  commit: string | null;
  branch: string | null;
  runStartedAt: string;
};

export type PerfExplainDbClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
};

export type PerfExplainReport = {
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
  representative_cases: PerfExplainCase[];
  notes: string[];
  plans: PerfExplainPlanResult[];
};

export type PerfExplainCase = {
  id: string;
  label: string;
  query: string;
  normalized_query: string;
  chosung_query: string;
  expected_song_id: string;
};

export type PerfExplainPlanResult = {
  id: string;
  query_shape: PerfExplainQueryShape;
  db_label: string;
  dataset_label: string;
  case_id: string | null;
  case_label: string | null;
  query: string | null;
  sql: string;
  params: unknown[];
  rows_planned: number | null;
  rows_scanned: number;
  rows_filtered: number;
  rows_returned: number | null;
  sort: {
    occurred: boolean;
    methods: string[];
  };
  index: {
    used: boolean;
    names: string[];
  };
  sequential_scan: {
    occurred: boolean;
    relations: string[];
  };
  planning_time_ms: number | null;
  execution_time_ms: number | null;
  plan_root: string;
  node_types: string[];
  plan: unknown;
};

export type PerfExplainQueryShape =
  | "song_aliases.normalized_alias.equals_insensitive"
  | "song_aliases.normalized_alias.starts_with_insensitive"
  | "song_aliases.normalized_alias.contains_insensitive"
  | "song_aliases.chosung_alias.starts_with_insensitive"
  | "song_aliases.id_in.detail"
  | "song_aliases.id_in.detail_with_song_and_karaoke_entries"
  | "karaoke_providers.active_for_search"
  | "karaoke_providers.active_default"
  | "GET /api/providers.active_country_order";

type SearchSmokeCase = ReturnType<typeof readSearchSmokeCases>[number];

type ExplainJson = {
  Plan?: PlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
};

type PlanNode = {
  "Node Type"?: string;
  "Plan Rows"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  "Index Name"?: string;
  "Relation Name"?: string;
  "Sort Method"?: string;
  Plans?: PlanNode[];
};

const DEFAULT_SEARCH_LIMIT = 20;
const MIN_EXACT_CANDIDATE_TAKE = 50;
const MIN_PREFIX_CANDIDATE_TAKE = 100;
const MIN_CHOSUNG_CANDIDATE_TAKE = 100;
const MIN_PARTIAL_CANDIDATE_TAKE = 200;
const MAX_PARTIAL_CANDIDATE_TAKE = 500;
const MAX_DETAIL_IDS = 50;

const ALIAS_ORDER_BY = "normalized_alias ASC, song_id ASC, alias ASC, id ASC";

export async function runPerfExplain(
  db: PerfExplainDbClient,
  options: PerfExplainOptions
): Promise<PerfExplainReport> {
  const cases = representativeCases(
    readSearchSmokeCases(options.fixturePath),
    options.caseLimit
  );
  const counts = await readDatasetCounts(db);
  const providerCountry = await readFirstProviderCountry(db);
  const plans: PerfExplainPlanResult[] = [];

  for (const searchCase of cases) {
    const candidatePlans = await explainSearchCandidatePlans(db, searchCase);
    plans.push(...candidatePlans);

    const aliasIds = await readDetailAliasIds(db, searchCase);
    plans.push(await explainAliasDetailPlan(db, searchCase, aliasIds));
    plans.push(
      await explainAliasDetailWithRelationsPlan(db, searchCase, aliasIds)
    );
  }

  plans.push(await explainActiveProvidersPlan(db));
  plans.push(await explainActiveDefaultProviderPlan(db));
  plans.push(await explainProviderListPlan(db, providerCountry));

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
    representative_cases: cases,
    notes: [
      "EXPLAIN ANALYZE is executed only for read-only SELECT statements.",
      "Search candidate SQL mirrors searchSongs() where/order/take shape and uses ILIKE to approximate Prisma case-insensitive equals/startsWith/contains on PostgreSQL.",
      "The relation detail SQL is a single JOIN approximation of aliasRecordSelect(); Prisma may issue relation loads with a different internal SQL shape.",
      "Detail plans use candidate alias IDs selected with the same representative query and are capped before IN-list EXPLAIN to avoid broad scans.",
      "db_label separates local and Neon runs; dataset_label separates current seed from future synthetic scale scenarios."
    ],
    plans: plans.map((plan) => ({
      ...plan,
      db_label: options.dbLabel,
      dataset_label: options.datasetLabel
    }))
  };
}

function representativeCases(
  smokeCases: SearchSmokeCase[],
  caseLimit: number | null
): PerfExplainCase[] {
  const selected: PerfExplainCase[] = [];
  const seen = new Set<string>();

  for (const smokeCase of smokeCases) {
    const label = smokeCase.label ?? smokeCase.query;

    if (seen.has(label)) {
      continue;
    }

    seen.add(label);
    selected.push({
      id: stableCaseId(smokeCase, selected.length),
      label,
      query: smokeCase.query,
      normalized_query: normalizeSearchText(smokeCase.query),
      chosung_query: normalizeChosungQuery(smokeCase.query),
      expected_song_id: smokeCase.expectedSongId
    });

    if (caseLimit !== null && selected.length >= caseLimit) {
      break;
    }
  }

  return selected;
}

async function readDatasetCounts(db: PerfExplainDbClient) {
  const [songs, aliases, entries, providers] = await Promise.all([
    readCount(db, "songs"),
    readCount(db, "song_aliases"),
    readCount(db, "karaoke_entries"),
    readCount(db, "karaoke_providers")
  ]);

  return {
    songs,
    song_aliases: aliases,
    karaoke_entries: entries,
    karaoke_providers: providers
  };
}

async function readCount(
  db: PerfExplainDbClient,
  tableName: "songs" | "song_aliases" | "karaoke_entries" | "karaoke_providers"
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${tableName}`
  );

  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

async function readFirstProviderCountry(
  db: PerfExplainDbClient
): Promise<string | null> {
  const result = await db.query<{ country: string }>(
    "SELECT country FROM karaoke_providers ORDER BY display_order ASC, name ASC, id ASC LIMIT 1"
  );

  return result.rows[0]?.country ?? null;
}

async function explainSearchCandidatePlans(
  db: PerfExplainDbClient,
  searchCase: PerfExplainCase
): Promise<PerfExplainPlanResult[]> {
  const plans = [
    candidatePlan(
      db,
      searchCase,
      "song_aliases.normalized_alias.equals_insensitive",
      "normalized_alias ILIKE $1",
      [searchCase.normalized_query],
      candidateTake("equals")
    ),
    candidatePlan(
      db,
      searchCase,
      "song_aliases.normalized_alias.starts_with_insensitive",
      "normalized_alias ILIKE ($1 || '%')",
      [searchCase.normalized_query],
      candidateTake("startsWith")
    ),
    candidatePlan(
      db,
      searchCase,
      "song_aliases.normalized_alias.contains_insensitive",
      "normalized_alias ILIKE ('%' || $1 || '%')",
      [searchCase.normalized_query],
      candidateTake("contains")
    )
  ];

  if (canUseHangulChosungSearch(searchCase.chosung_query)) {
    plans.push(
      candidatePlan(
        db,
        searchCase,
        "song_aliases.chosung_alias.starts_with_insensitive",
        "chosung_alias ILIKE ($1 || '%')",
        [searchCase.chosung_query],
        candidateTake("chosung")
      )
    );
  }

  return Promise.all(plans);
}

async function candidatePlan(
  db: PerfExplainDbClient,
  searchCase: PerfExplainCase,
  queryShape: PerfExplainQueryShape,
  whereSql: string,
  values: unknown[],
  take: number
): Promise<PerfExplainPlanResult> {
  const sql = `SELECT id
FROM song_aliases
WHERE ${whereSql}
ORDER BY ${ALIAS_ORDER_BY}
LIMIT $${values.length + 1}`;

  return explainPlan(db, {
    id: `${searchCase.id}.${queryShape}`,
    queryShape,
    searchCase,
    sql,
    params: [...values, take]
  });
}

async function readDetailAliasIds(
  db: PerfExplainDbClient,
  searchCase: PerfExplainCase
): Promise<string[]> {
  const ids = new Set<string>();
  const candidateQueries = [
    {
      sql: `SELECT id FROM song_aliases WHERE normalized_alias ILIKE $1 ORDER BY ${ALIAS_ORDER_BY} LIMIT $2`,
      params: [searchCase.normalized_query, candidateTake("equals")]
    },
    {
      sql: `SELECT id FROM song_aliases WHERE normalized_alias ILIKE ($1 || '%') ORDER BY ${ALIAS_ORDER_BY} LIMIT $2`,
      params: [searchCase.normalized_query, candidateTake("startsWith")]
    },
    {
      sql: `SELECT id FROM song_aliases WHERE normalized_alias ILIKE ('%' || $1 || '%') ORDER BY ${ALIAS_ORDER_BY} LIMIT $2`,
      params: [searchCase.normalized_query, candidateTake("contains")]
    }
  ];

  if (canUseHangulChosungSearch(searchCase.chosung_query)) {
    candidateQueries.push({
      sql: `SELECT id FROM song_aliases WHERE chosung_alias ILIKE ($1 || '%') ORDER BY ${ALIAS_ORDER_BY} LIMIT $2`,
      params: [searchCase.chosung_query, candidateTake("chosung")]
    });
  }

  for (const candidateQuery of candidateQueries) {
    const result = await db.query<{ id: string }>(
      candidateQuery.sql,
      candidateQuery.params
    );

    for (const row of result.rows) {
      ids.add(row.id);

      if (ids.size >= MAX_DETAIL_IDS) {
        return Array.from(ids);
      }
    }
  }

  return Array.from(ids);
}

async function explainAliasDetailPlan(
  db: PerfExplainDbClient,
  searchCase: PerfExplainCase,
  aliasIds: string[]
): Promise<PerfExplainPlanResult> {
  const sql = `SELECT id, song_id, alias, language, alias_type, normalized_alias, chosung_alias
FROM song_aliases
WHERE id = ANY($1::varchar[])
ORDER BY ${ALIAS_ORDER_BY}`;

  return explainPlan(db, {
    id: `${searchCase.id}.song_aliases.id_in.detail`,
    queryShape: "song_aliases.id_in.detail",
    searchCase,
    sql,
    params: [aliasIds]
  });
}

async function explainAliasDetailWithRelationsPlan(
  db: PerfExplainDbClient,
  searchCase: PerfExplainCase,
  aliasIds: string[]
): Promise<PerfExplainPlanResult> {
  const sql = `SELECT
  a.id AS alias_id,
  a.song_id,
  a.alias,
  a.language,
  a.alias_type,
  a.normalized_alias,
  a.chosung_alias,
  s.id AS song_id,
  s.original_language,
  s.canonical_title,
  s.display_title,
  s.canonical_artist,
  s.release_year,
  s.tie_in,
  e.id AS karaoke_entry_id,
  e.provider_id,
  e.karaoke_number,
  e.version_info,
  e.availability_status,
  e.last_verified_at
FROM song_aliases a
JOIN songs s ON s.id = a.song_id
LEFT JOIN karaoke_entries e ON e.song_id = s.id
WHERE a.id = ANY($1::varchar[])
ORDER BY a.normalized_alias ASC, a.song_id ASC, a.alias ASC, a.id ASC,
  e.provider_id ASC, e.availability_status ASC, e.version_info ASC,
  e.karaoke_number ASC, e.id ASC`;

  return explainPlan(db, {
    id: `${searchCase.id}.song_aliases.id_in.detail_with_song_and_karaoke_entries`,
    queryShape: "song_aliases.id_in.detail_with_song_and_karaoke_entries",
    searchCase,
    sql,
    params: [aliasIds]
  });
}

async function explainActiveProvidersPlan(
  db: PerfExplainDbClient
): Promise<PerfExplainPlanResult> {
  const sql = `SELECT id, is_active, is_default
FROM karaoke_providers
WHERE is_active = true
ORDER BY display_order ASC, name ASC, id ASC`;

  return explainPlan(db, {
    id: "karaoke_providers.active_for_search",
    queryShape: "karaoke_providers.active_for_search",
    searchCase: null,
    sql,
    params: []
  });
}

async function explainActiveDefaultProviderPlan(
  db: PerfExplainDbClient
): Promise<PerfExplainPlanResult> {
  const sql = `SELECT id, is_active, is_default
FROM karaoke_providers
WHERE is_active = true AND is_default = true
ORDER BY display_order ASC, name ASC, id ASC`;

  return explainPlan(db, {
    id: "karaoke_providers.active_default",
    queryShape: "karaoke_providers.active_default",
    searchCase: null,
    sql,
    params: []
  });
}

async function explainProviderListPlan(
  db: PerfExplainDbClient,
  country: string | null
): Promise<PerfExplainPlanResult> {
  const sql = `SELECT id, name, country, is_active, display_order, is_default, last_catalog_updated_at
FROM karaoke_providers
WHERE country = $1 AND is_active = true
ORDER BY display_order ASC, name ASC, id ASC`;

  return explainPlan(db, {
    id: "GET /api/providers.active_country_order",
    queryShape: "GET /api/providers.active_country_order",
    searchCase: null,
    sql,
    params: [country ?? "KR"]
  });
}

type ExplainPlanInput = {
  id: string;
  queryShape: PerfExplainQueryShape;
  searchCase: PerfExplainCase | null;
  sql: string;
  params: unknown[];
};

async function explainPlan(
  db: PerfExplainDbClient,
  input: ExplainPlanInput
): Promise<PerfExplainPlanResult> {
  const explain = await db.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${input.sql}`,
    input.params
  );
  const json = readExplainJson(explain.rows);
  const plan = json.Plan ?? {};
  const summary = summarizePlan(plan);

  return {
    id: input.id,
    query_shape: input.queryShape,
    db_label: "",
    dataset_label: "",
    case_id: input.searchCase?.id ?? null,
    case_label: input.searchCase?.label ?? null,
    query: input.searchCase?.query ?? null,
    sql: input.sql,
    params: input.params,
    rows_planned: numericOrNull(plan["Plan Rows"]),
    rows_scanned: summary.rowsScanned,
    rows_filtered: summary.rowsFiltered,
    rows_returned: numericOrNull(plan["Actual Rows"]),
    sort: {
      occurred: summary.sortMethods.length > 0,
      methods: summary.sortMethods
    },
    index: {
      used: summary.indexNames.length > 0,
      names: summary.indexNames
    },
    sequential_scan: {
      occurred: summary.seqScanRelations.length > 0,
      relations: summary.seqScanRelations
    },
    planning_time_ms: numericOrNull(json["Planning Time"]),
    execution_time_ms: numericOrNull(json["Execution Time"]),
    plan_root: plan["Node Type"] ?? "Unknown",
    node_types: summary.nodeTypes,
    plan: json
  };
}

function readExplainJson(rows: Record<string, unknown>[]): ExplainJson {
  const firstRow = rows[0];

  if (firstRow === undefined) {
    throw new Error("EXPLAIN returned no rows.");
  }

  const value = firstRow["QUERY PLAN"];

  if (!Array.isArray(value) || value[0] === undefined) {
    throw new Error("EXPLAIN did not return FORMAT JSON output.");
  }

  return value[0] as ExplainJson;
}

function summarizePlan(root: PlanNode) {
  const nodeTypes = new Set<string>();
  const indexNames = new Set<string>();
  const seqScanRelations = new Set<string>();
  const sortMethods = new Set<string>();
  let rowsScanned = 0;
  let rowsFiltered = 0;

  function visit(node: PlanNode) {
    const nodeType = node["Node Type"] ?? "Unknown";
    const loops = node["Actual Loops"] ?? 1;
    const actualRows = node["Actual Rows"] ?? 0;
    const removedByFilter = node["Rows Removed by Filter"] ?? 0;
    const removedByIndexRecheck = node["Rows Removed by Index Recheck"] ?? 0;
    const removedRows = removedByFilter + removedByIndexRecheck;

    nodeTypes.add(nodeType);
    rowsFiltered += removedRows * loops;

    if (nodeType.includes("Scan")) {
      rowsScanned += actualRows * loops + removedRows * loops;
    }

    if (nodeType.includes("Index")) {
      const indexName = node["Index Name"];

      if (indexName !== undefined) {
        indexNames.add(indexName);
      }
    }

    if (nodeType === "Seq Scan") {
      const relationName = node["Relation Name"];

      if (relationName !== undefined) {
        seqScanRelations.add(relationName);
      }
    }

    if (nodeType.includes("Sort")) {
      sortMethods.add(node["Sort Method"] ?? nodeType);
    }

    for (const child of node.Plans ?? []) {
      visit(child);
    }
  }

  visit(root);

  return {
    rowsScanned: Math.round(rowsScanned),
    rowsFiltered: Math.round(rowsFiltered),
    nodeTypes: Array.from(nodeTypes),
    indexNames: Array.from(indexNames),
    seqScanRelations: Array.from(seqScanRelations),
    sortMethods: Array.from(sortMethods)
  };
}

function candidateTake(kind: "equals" | "startsWith" | "contains" | "chosung") {
  if (kind === "equals") {
    return Math.max(MIN_EXACT_CANDIDATE_TAKE, DEFAULT_SEARCH_LIMIT * 2);
  }

  if (kind === "startsWith") {
    return Math.max(MIN_PREFIX_CANDIDATE_TAKE, DEFAULT_SEARCH_LIMIT * 5);
  }

  if (kind === "chosung") {
    return Math.max(MIN_CHOSUNG_CANDIDATE_TAKE, DEFAULT_SEARCH_LIMIT * 5);
  }

  return Math.min(
    MAX_PARTIAL_CANDIDATE_TAKE,
    Math.max(MIN_PARTIAL_CANDIDATE_TAKE, DEFAULT_SEARCH_LIMIT * 10)
  );
}

function numericOrNull(value: number | undefined): number | null {
  return value === undefined ? null : value;
}

function stableCaseId(smokeCase: SearchSmokeCase, index: number): string {
  const labelSlug = slug(smokeCase.label ?? smokeCase.query) || "case";
  const suffix = String(index + 1).padStart(2, "0");

  return `${labelSlug}-${suffix}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
}
