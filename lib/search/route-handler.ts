import {
  InvalidProviderError,
  parseSearchQuery,
  searchSongs,
  type SearchDbClient,
  type SearchQuery,
  type SearchResponse
} from "./search";

type SearchFunction = (query: SearchQuery) => Promise<SearchResponse>;

export function createSearchGetHandler(search: SearchFunction) {
  return async function GET(request: Request): Promise<Response> {
    const parsed = parseSearchQuery(new URL(request.url).searchParams);

    if (!parsed.ok) {
      return jsonResponse(
        {
          error: {
            code: parsed.code,
            message: parsed.message
          }
        },
        400
      );
    }

    try {
      return jsonResponse(await search(parsed.query));
    } catch (error) {
      if (error instanceof InvalidProviderError) {
        return jsonResponse(
          {
            error: {
              code: "INVALID_PROVIDER",
              message: "provider_id must reference an active provider."
            }
          },
          400
        );
      }

      console.error("Failed to search songs", error);

      return jsonResponse(
        {
          error: {
            code: "SEARCH_FAILED",
            message: "Failed to search songs."
          }
        },
        500
      );
    }
  };
}

export function createSearchGetHandlerForDb(db: SearchDbClient) {
  return createSearchGetHandler((query) => searchSongs(db, query));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
