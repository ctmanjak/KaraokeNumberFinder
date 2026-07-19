import "server-only";

import { readAuthEnvironment } from "../auth/env";
import { getServerAuth } from "../auth/server";
import { personalizationError } from "./errors";
import {
  createPersonalizationHandler,
  type PersonalizationRouteHandler
} from "./handler";
import { createRequireSession } from "./session";

const requireServerSession = createRequireSession(async (input) => {
  const auth = getServerAuth();
  return auth.api.getSession(input);
});

export async function requireSession(request: Request) {
  return requireServerSession(request);
}

export function createServerPersonalizationHandler(
  handler: PersonalizationRouteHandler
) {
  return createPersonalizationHandler(handler, {
    requireSession,
    trustedOrigin() {
      try {
        return readAuthEnvironment().trustedOrigin;
      } catch {
        throw personalizationError("PERSONALIZATION_UNAVAILABLE");
      }
    }
  });
}
