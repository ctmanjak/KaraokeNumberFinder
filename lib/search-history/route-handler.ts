import {
  ownedWhere,
  parseJsonBody,
  personalizationError,
  requireValidInput,
  type PersonalizationRouteHandler
} from "../personalization";
import type { SearchHistoryService } from "./service";

const SEARCH_HISTORY_PATH = "/api/search-history";
const SEARCH_HISTORY_ID_PATH_PREFIX = `${SEARCH_HISTORY_PATH}/`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type SearchHistoryPostBody = Readonly<{ query: string }>;

export function createSearchHistoryGetHandler(
  service: SearchHistoryService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    requireNoQueryParameters(request);
    return Response.json(await service.list(ownedWhere(auth, {})));
  };
}

export function createSearchHistoryPostHandler(
  service: SearchHistoryService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    requireNoQueryParameters(request);
    const body = requireValidInput(
      await parseJsonBody(request),
      isSearchHistoryPostBody
    );

    return Response.json(
      await service.save(ownedWhere(auth, { query: body.query }))
    );
  };
}

export function createSearchHistoryDeleteAllHandler(
  service: SearchHistoryService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    requireNoQueryParameters(request);
    return Response.json(await service.clear(ownedWhere(auth, {})));
  };
}

export function createSearchHistoryDeleteOneHandler(
  service: SearchHistoryService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    requireNoQueryParameters(request);
    const id = parseSearchHistoryId(request);
    return Response.json(await service.delete(ownedWhere(auth, { id })));
  };
}

export function parseSearchHistoryId(request: Request): string {
  const pathname = new URL(request.url).pathname;
  const encodedId = pathname.startsWith(SEARCH_HISTORY_ID_PATH_PREFIX)
    ? pathname.slice(SEARCH_HISTORY_ID_PATH_PREFIX.length)
    : "";
  let id = "";

  try {
    id = decodeURIComponent(encodedId);
  } catch {
    throw personalizationError("VALIDATION_ERROR");
  }

  return requireValidInput(id, isSearchHistoryId);
}

function requireNoQueryParameters(request: Request): void {
  if (new URL(request.url).searchParams.size !== 0) {
    throw personalizationError("INVALID_REQUEST");
  }
}

function isSearchHistoryPostBody(
  input: unknown
): input is SearchHistoryPostBody {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    "query" in input &&
    typeof input.query === "string"
  );
}

function isSearchHistoryId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
