import { createServerPersonalizationHandler } from "@/lib/personalization/server";
import { createDefaultProviderPutHandler } from "@/lib/user-preference/route-handler";
import { getUserPreferenceService } from "@/lib/user-preference/server";

export const PUT = createServerPersonalizationHandler((context) =>
  createDefaultProviderPutHandler(getUserPreferenceService())(context)
);
