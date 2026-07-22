import { createServerPersonalizationHandler } from "@/lib/personalization/server";
import { createUserPreferenceGetHandler } from "@/lib/user-preference/route-handler";
import { getUserPreferenceService } from "@/lib/user-preference/server";

export const GET = createServerPersonalizationHandler((context) =>
  createUserPreferenceGetHandler(getUserPreferenceService())(context)
);
