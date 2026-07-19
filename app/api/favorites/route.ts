import { createFavoritesGetHandler } from "@/lib/favorites/route-handler";
import { getFavoriteService } from "@/lib/favorites/server";
import { createServerPersonalizationHandler } from "@/lib/personalization/server";

export const GET = createServerPersonalizationHandler((context) =>
  createFavoritesGetHandler(getFavoriteService())(context)
);
