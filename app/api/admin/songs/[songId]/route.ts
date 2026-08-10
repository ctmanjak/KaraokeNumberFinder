import { createServerAdminCatalogHandler } from "@/lib/admin-catalog/server";
import { createAdminSongUpdateAuditCompletion } from "@/lib/admin-song-detail/audit";
import {
  createAdminSongDetailGetHandler,
  createAdminSongDetailPatchHandler
} from "@/lib/admin-song-detail/route-handler";
import { getAdminSongDetailService } from "@/lib/admin-song-detail/server";

type RouteContext = Readonly<{
  params: Promise<{ songId: string }>;
}>;

export async function GET(request: Request, context: RouteContext) {
  const { songId } = await context.params;
  return createServerAdminCatalogHandler(
    "song_detail_api",
    createAdminSongDetailGetHandler(getAdminSongDetailService(), songId)
  )(request);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { songId } = await context.params;
  const safeSongId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(songId)
    ? songId
    : undefined;
  return createServerAdminCatalogHandler(
    "song_update_api",
    createAdminSongDetailPatchHandler(getAdminSongDetailService(), songId),
    {
      requireJsonInCsrf: false,
      onComplete: createAdminSongUpdateAuditCompletion(safeSongId)
    }
  )(request);
}
