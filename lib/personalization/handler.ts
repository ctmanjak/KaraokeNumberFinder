import { isMutationMethod, validateMutationRequest } from "./csrf";
import {
  createPersonalizationErrorResponse,
  createPersonalizationRequestId,
  type WritePersonalizationSafeLog
} from "./errors";
import type { AuthContext, RequireSession } from "./session";

export type PersonalizationHandlerContext = Readonly<{
  request: Request;
  auth: AuthContext;
  requestId: string;
}>;

export type PersonalizationRouteHandler = (
  context: PersonalizationHandlerContext
) => Response | Promise<Response>;

export type PersonalizationHandlerDependencies = {
  requireSession: RequireSession;
  trustedOrigin: string | (() => string);
  generateRequestId?: () => string;
  writeSafeLog?: WritePersonalizationSafeLog;
};

export function createPersonalizationHandler(
  handler: PersonalizationRouteHandler,
  dependencies: PersonalizationHandlerDependencies
) {
  return async function protectedHandler(request: Request): Promise<Response> {
    const requestId =
      dependencies.generateRequestId?.() ?? createPersonalizationRequestId();

    try {
      if (isMutationMethod(request.method)) {
        const trustedOrigin =
          typeof dependencies.trustedOrigin === "function"
            ? dependencies.trustedOrigin()
            : dependencies.trustedOrigin;
        validateMutationRequest(request, trustedOrigin);
      } else {
        validateMutationRequest(request);
      }

      const auth = await dependencies.requireSession(request);
      const response = await handler({ request, auth, requestId });
      return withProtectedCachePolicy(response);
    } catch (error) {
      return createPersonalizationErrorResponse(error, {
        requestId,
        writeSafeLog: dependencies.writeSafeLog
      });
    }
  };
}

function withProtectedCachePolicy(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
