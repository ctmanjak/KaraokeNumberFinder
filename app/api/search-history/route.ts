import {
  createSearchHistoryDeleteAllHandler,
  createSearchHistoryGetHandler,
  createSearchHistoryPostHandler
} from "@/lib/search-history/route-handler";
import { getSearchHistoryService } from "@/lib/search-history/server";
import { createServerPersonalizationHandler } from "@/lib/personalization/server";

export const GET = createServerPersonalizationHandler((context) =>
  createSearchHistoryGetHandler(getSearchHistoryService())(context)
);

export const POST = createServerPersonalizationHandler((context) =>
  createSearchHistoryPostHandler(getSearchHistoryService())(context)
);

export const DELETE = createServerPersonalizationHandler((context) =>
  createSearchHistoryDeleteAllHandler(getSearchHistoryService())(context)
);
