import { createServerPersonalizationHandler } from "@/lib/personalization/server";
import { createUserDataMergePostHandler } from "@/lib/user-data-merge/route-handler";
import { getUserDataMergeService } from "@/lib/user-data-merge/server";

export const POST = createServerPersonalizationHandler((context) =>
  createUserDataMergePostHandler(getUserDataMergeService())(context)
);
