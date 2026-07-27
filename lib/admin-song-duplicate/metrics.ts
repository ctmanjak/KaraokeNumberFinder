export type AdminSongDuplicateMetric = Readonly<{
  event: "admin_song.duplicate_check";
  route: "song_duplicate_check_api";
  http_status: number;
  latency_ms: number;
  timeout: boolean;
  in_flight: number;
}>;

export type WriteAdminSongDuplicateMetric = (
  metric: AdminSongDuplicateMetric
) => void;

let duplicateChecksInFlight = 0;

export function withAdminSongDuplicateMetrics(
  handler: (request: Request) => Promise<Response>,
  writer: WriteAdminSongDuplicateMetric = defaultMetricWriter,
  clock: () => number = () => performance.now()
) {
  return async (request: Request): Promise<Response> => {
    const startedAt = clock();
    duplicateChecksInFlight += 1;
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      writeMetric(
        {
          event: "admin_song.duplicate_check",
          route: "song_duplicate_check_api",
          http_status: 500,
          latency_ms: elapsed(clock(), startedAt),
          timeout: false,
          in_flight: duplicateChecksInFlight
        },
        writer
      );
      throw error;
    } finally {
      duplicateChecksInFlight -= 1;
    }
    writeMetric(
      {
        event: "admin_song.duplicate_check",
        route: "song_duplicate_check_api",
        http_status: response.status,
        latency_ms: elapsed(clock(), startedAt),
        timeout: response.status === 503,
        in_flight: duplicateChecksInFlight + 1
      },
      writer
    );
    return response;
  };
}

function elapsed(finishedAt: number, startedAt: number): number {
  return Number(Math.max(0, finishedAt - startedAt).toFixed(3));
}

function writeMetric(
  metric: AdminSongDuplicateMetric,
  writer: WriteAdminSongDuplicateMetric
): void {
  try {
    writer(metric);
  } catch {
    console.error("[admin-song] Duplicate-check metric sink failed.");
  }
}

function defaultMetricWriter(metric: AdminSongDuplicateMetric): void {
  console.info(`[admin-song] Duplicate-check metric ${JSON.stringify(metric)}`);
}
