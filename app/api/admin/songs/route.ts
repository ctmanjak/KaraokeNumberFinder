import {
  createAdminSongListHandler,
  createAdminSongPostHandler
} from "@/lib/admin-song/route-handler";
import { createAdminSongCreateAuditCompletion } from "@/lib/admin-song/audit";
import { getAdminSongService } from "@/lib/admin-song/server";
import { createServerAdminCatalogHandler } from "@/lib/admin-catalog/server";

export const GET = createServerAdminCatalogHandler(
  "songs_list_api",
  (context) => createAdminSongListHandler(getAdminSongService())(context)
);

export const POST = createServerAdminCatalogHandler(
  "song_create_api",
  (context) => createAdminSongPostHandler(getAdminSongService())(context),
  {
    requireJsonInCsrf: false,
    onComplete: createAdminSongCreateAuditCompletion()
  }
);
