import {
  createFavoriteDeleteHandler,
  createFavoritePutHandler
} from "@/lib/favorites/route-handler";
import { getFavoriteService } from "@/lib/favorites/server";
import { createServerPersonalizationHandler } from "@/lib/personalization/server";

export const PUT = createServerPersonalizationHandler((context) =>
  createFavoritePutHandler(getFavoriteService())(context)
);

export const DELETE = createServerPersonalizationHandler((context) =>
  createFavoriteDeleteHandler(getFavoriteService())(context)
);
