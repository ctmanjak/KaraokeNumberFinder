import { createServerAdminCatalogHandler } from "@/lib/admin-catalog/server";
import { withAdminSongDuplicateMetrics } from "@/lib/admin-song-duplicate/metrics";
import { createAdminSongDuplicateCheckHandler } from "@/lib/admin-song-duplicate/route-handler";
import { getAdminSongDuplicateService } from "@/lib/admin-song-duplicate/server";

export const POST = withAdminSongDuplicateMetrics(
  createServerAdminCatalogHandler(
    "song_duplicate_check_api",
    (context) =>
      createAdminSongDuplicateCheckHandler(getAdminSongDuplicateService())(
        context
      ),
    { requireJsonInCsrf: false }
  )
);
