import {
  listProviders,
  parseProviderListQuery,
  type ProviderDbClient,
  type ProviderListItem,
  type ProviderListQuery
} from "./providers";

type ProviderListFunction = (
  query: ProviderListQuery
) => Promise<ProviderListItem[]>;

export function createProvidersGetHandler(
  listProviderItems: ProviderListFunction
) {
  return async function GET(request: Request): Promise<Response> {
    const parsed = parseProviderListQuery(new URL(request.url).searchParams);

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
      const items = await listProviderItems(parsed.query);

      return jsonResponse({ items });
    } catch (error) {
      console.error("Failed to list karaoke providers", error);

      return jsonResponse(
        {
          error: {
            code: "PROVIDER_LIST_FAILED",
            message: "Failed to list providers."
          }
        },
        500
      );
    }
  };
}

export function createProvidersGetHandlerForDb(db: ProviderDbClient) {
  return createProvidersGetHandler((query) => listProviders(db, query));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
