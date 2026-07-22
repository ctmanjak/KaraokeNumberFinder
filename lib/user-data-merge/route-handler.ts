import {
  ownedWhere,
  parseJsonBody,
  personalizationError,
  requireValidInput,
  type PersonalizationRouteHandler
} from "../personalization";
import { isDefaultProviderId } from "../preferences/default-provider";
import { MAX_SEARCH_HISTORY_ITEMS } from "../search-history/service";
import type { UserDataMergeService } from "./service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type UserDataMergePostBody = Readonly<{
  merge_id: string;
  recent_searches: ReadonlyArray<
    Readonly<{ query: string; searched_at: string }>
  >;
  default_provider_id?: string;
}>;

export function createUserDataMergePostHandler(
  service: UserDataMergeService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    requireNoQueryParameters(request);
    const body = requireValidInput(
      await parseJsonBody(request),
      isUserDataMergePostBody
    );

    return Response.json(
      await service.merge(
        ownedWhere(auth, {
          mergeId: body.merge_id,
          recentSearches: body.recent_searches.map((item) => ({
            query: item.query,
            searchedAt: item.searched_at
          })),
          ...(body.default_provider_id === undefined
            ? {}
            : { defaultProviderId: body.default_provider_id })
        })
      )
    );
  };
}

function requireNoQueryParameters(request: Request): void {
  if (new URL(request.url).searchParams.size !== 0) {
    throw personalizationError("INVALID_REQUEST");
  }
}

function isUserDataMergePostBody(
  input: unknown
): input is UserDataMergePostBody {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const keys = Object.keys(input);
  if (
    keys.length < 2 ||
    keys.length > 3 ||
    keys.some(
      (key) =>
        key !== "merge_id" &&
        key !== "recent_searches" &&
        key !== "default_provider_id"
    ) ||
    !("merge_id" in input) ||
    typeof input.merge_id !== "string" ||
    !UUID_PATTERN.test(input.merge_id) ||
    !("recent_searches" in input) ||
    !Array.isArray(input.recent_searches) ||
    input.recent_searches.length > MAX_SEARCH_HISTORY_ITEMS ||
    !input.recent_searches.every(isRecentSearch)
  ) {
    return false;
  }

  return (
    !("default_provider_id" in input) ||
    isDefaultProviderId(input.default_provider_id)
  );
}

function isRecentSearch(
  input: unknown
): input is Readonly<{ query: string; searched_at: string }> {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).length === 2 &&
    "query" in input &&
    typeof input.query === "string" &&
    "searched_at" in input &&
    typeof input.searched_at === "string"
  );
}
