import {
  InvalidProviderError,
  parseSearchQuery,
  searchSongs,
  type SearchDbClient,
  type SearchQuery,
  type SearchResponse
} from "./search";
import {
  createTimingRecorder,
  measureAsync,
  measureSync,
  type SearchTimingEvent,
  type SearchTimingRecorder
} from "./timing";

type SearchFunction = (
  query: SearchQuery,
  context?: { timing?: SearchTimingRecorder }
) => Promise<SearchResponse>;

export function createSearchGetHandler(search: SearchFunction) {
  return async function GET(request: Request): Promise<Response> {
    const totalStartedAt = performance.now();
    const url = new URL(request.url);
    const timingEnabled = shouldEmitPerfTiming(request, url);
    const timingState = timingEnabled ? createTimingRecorder() : undefined;
    const timing = timingState?.recorder;
    const timings = timingState?.timings ?? [];
    const parsed = measureSync(timing, "route.parse", () =>
      parseSearchQuery(url.searchParams)
    );

    if (!parsed.ok) {
      return timedJsonResponse(
        {
          error: {
            code: parsed.code,
            message: parsed.message
          }
        },
        400,
        timings,
        timing,
        totalStartedAt,
        timingEnabled
      );
    }

    try {
      const body = await measureAsync(timing, "route.search", () =>
        search(parsed.query, { timing })
      );

      return timedJsonResponse(
        body,
        200,
        timings,
        timing,
        totalStartedAt,
        timingEnabled
      );
    } catch (error) {
      if (error instanceof InvalidProviderError) {
        return timedJsonResponse(
          {
            error: {
              code: "INVALID_PROVIDER",
              message: "provider_id must reference an active provider."
            }
          },
          400,
          timings,
          timing,
          totalStartedAt,
          timingEnabled
        );
      }

      console.error("Failed to search songs", error);

      return timedJsonResponse(
        {
          error: {
            code: "SEARCH_FAILED",
            message: "Failed to search songs."
          }
        },
        500,
        timings,
        timing,
        totalStartedAt,
        timingEnabled
      );
    }
  };
}

export function createSearchGetHandlerForDb(db: SearchDbClient) {
  return createSearchGetHandler((query, context) =>
    searchSongs(db, query, { timing: context?.timing })
  );
}

function timedJsonResponse(
  body: unknown,
  status: number,
  timings: SearchTimingEvent[],
  timing: SearchTimingRecorder | undefined,
  totalStartedAt: number,
  timingEnabled: boolean
): Response {
  const json = measureSync(timing, "route.json", () => JSON.stringify(body));

  if (timingEnabled) {
    timing?.record("route.total", performance.now() - totalStartedAt);
  }

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8"
  });

  if (timingEnabled) {
    headers.set("server-timing", toServerTimingHeader(timings));
    headers.set("x-perf-timing", JSON.stringify(timings));
  }

  return new Response(json, {
    status,
    headers
  });
}

function shouldEmitPerfTiming(request: Request, url: URL): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return (
    request.headers.get("x-perf-timing") === "1" ||
    url.searchParams.get("__perf_timing") === "1"
  );
}

function toServerTimingHeader(timings: SearchTimingEvent[]): string {
  return timings
    .map(
      (timing) => `${serverTimingName(timing.name)};dur=${timing.duration_ms}`
    )
    .join(", ");
}

function serverTimingName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/gu, "_");
}
