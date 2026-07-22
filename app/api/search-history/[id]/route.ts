import { createSearchHistoryDeleteOneHandler } from "@/lib/search-history/route-handler";
import { getSearchHistoryService } from "@/lib/search-history/server";
import { createServerPersonalizationHandler } from "@/lib/personalization/server";

export const DELETE = createServerPersonalizationHandler((context) =>
  createSearchHistoryDeleteOneHandler(getSearchHistoryService())(context)
);
