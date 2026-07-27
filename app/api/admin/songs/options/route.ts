import { createAdminSongOptionsHandler } from "@/lib/admin-song/route-handler";
import { getAdminSongService } from "@/lib/admin-song/server";
import { createServerAdminCatalogHandler } from "@/lib/admin-catalog/server";

export const GET = createServerAdminCatalogHandler(
  "songs_options_api",
  (context) => createAdminSongOptionsHandler(getAdminSongService())(context)
);
