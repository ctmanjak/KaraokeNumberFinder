import {
  createPersonalizationErrorResponse,
  createPersonalizationRequestId,
  isMutationMethod,
  personalizationDomainError,
  personalizationError,
  PersonalizationApiError,
  validateMutationRequest,
  type AuthContext,
  type PersonalizationRouteHandler,
  type RequireSession,
  type WritePersonalizationSafeLog
} from "../personalization";

export const ADMIN_CATALOG_ROUTE_CATEGORIES = [
  "catalog_menu_api",
  "songs_list_page",
  "song_create_page",
  "song_detail_page",
  "songs_list_api",
  "songs_options_api",
  "song_create_api",
  "song_detail_api",
  "song_update_api",
  "song_duplicate_check_api"
] as const;

export type AdminCatalogRouteCategory =
  (typeof ADMIN_CATALOG_ROUTE_CATEGORIES)[number];

export type AdminCatalogFeatureDeniedEvent = Readonly<{
  event: "admin_catalog.feature_denied";
  occurred_at: string;
  request_id: string;
  route_category: AdminCatalogRouteCategory;
  actor_user_id: string;
}>;

export type WriteAdminCatalogFeatureDeniedEvent = (
  event: AdminCatalogFeatureDeniedEvent
) => void;

export type AdminCatalogActorRole = "admin" | "user" | null;

export type AdminCatalogGuardDependencies = Readonly<{
  requireSession: RequireSession;
  readActorRole: (userId: string) => Promise<AdminCatalogActorRole>;
  isCatalogEnabled: () => boolean;
  writeFeatureDeniedEvent?: WriteAdminCatalogFeatureDeniedEvent;
  now?: () => Date;
}>;

export type AdminCatalogHandlerDependencies = AdminCatalogGuardDependencies &
  Readonly<{
    trustedOrigin: string | (() => string);
    generateRequestId?: () => string;
    writeSafeLog?: WritePersonalizationSafeLog;
    requireJsonInCsrf?: boolean;
    onComplete?: (event: AdminCatalogHandlerCompletion) => void | Promise<void>;
  }>;

export type AdminCatalogHandlerCompletion = Readonly<{
  requestId: string;
  actorUserId?: string;
  response: Response;
  error?: unknown;
}>;

export type AdminCatalogPageAccess =
  | Readonly<{ status: "allowed"; auth: AuthContext; requestId: string }>
  | Readonly<{
      status: "guest" | "forbidden" | "feature_off" | "unavailable";
      requestId: string;
    }>;

export async function authorizeAdminCatalogRequest(
  request: Request,
  requestId: string,
  routeCategory: AdminCatalogRouteCategory,
  dependencies: AdminCatalogGuardDependencies,
  onActor?: (userId: string) => void
): Promise<AuthContext> {
  const auth = await dependencies.requireSession(request);
  onActor?.(auth.user.id);
  const role = await dependencies.readActorRole(auth.user.id);
  if (role !== "admin") {
    throw personalizationError("FORBIDDEN");
  }

  if (!dependencies.isCatalogEnabled()) {
    if (shouldWriteFeatureDeniedEvent(routeCategory)) {
      writeFeatureDeniedEvent(
        {
          event: "admin_catalog.feature_denied",
          occurred_at: (dependencies.now ?? (() => new Date()))().toISOString(),
          request_id: requestId,
          route_category: routeCategory,
          actor_user_id: auth.user.id
        },
        dependencies.writeFeatureDeniedEvent
      );
    }
    throw adminCatalogNotEnabledError();
  }

  return auth;
}

export function createAdminCatalogHandler(
  routeCategory: AdminCatalogRouteCategory,
  handler: PersonalizationRouteHandler,
  dependencies: AdminCatalogHandlerDependencies
) {
  return async function adminCatalogHandler(
    request: Request
  ): Promise<Response> {
    const requestId =
      dependencies.generateRequestId?.() ?? createPersonalizationRequestId();
    let actorUserId: string | undefined;
    let response: Response;
    let caughtError: unknown;

    try {
      const auth = await authorizeAdminCatalogRequest(
        request,
        requestId,
        routeCategory,
        dependencies,
        (userId) => {
          actorUserId = userId;
        }
      );

      if (isMutationMethod(request.method)) {
        const trustedOrigin =
          typeof dependencies.trustedOrigin === "function"
            ? dependencies.trustedOrigin()
            : dependencies.trustedOrigin;
        validateMutationRequest(request, trustedOrigin, {
          requireJson: dependencies.requireJsonInCsrf
        });
      } else {
        validateMutationRequest(request);
      }

      response = withProtectedCachePolicy(
        await handler({ request, auth, requestId }),
        requestId
      );
    } catch (error) {
      caughtError = error;
      response = createPersonalizationErrorResponse(error, {
        requestId,
        writeSafeLog: dependencies.writeSafeLog
      });
    }
    try {
      await dependencies.onComplete?.({
        requestId,
        ...(actorUserId === undefined ? {} : { actorUserId }),
        response: response.clone(),
        ...(caughtError === undefined ? {} : { error: caughtError })
      });
    } catch {
      console.error("[admin-catalog] Completion sink failed.");
    }
    return response;
  };
}

export async function resolveAdminCatalogPageAccess(
  request: Request,
  routeCategory: AdminCatalogRouteCategory,
  dependencies: AdminCatalogGuardDependencies,
  generateRequestId: () => string = createPersonalizationRequestId
): Promise<AdminCatalogPageAccess> {
  const requestId = generateRequestId();
  try {
    const auth = await authorizeAdminCatalogRequest(
      request,
      requestId,
      routeCategory,
      dependencies
    );
    return { status: "allowed", auth, requestId };
  } catch (error) {
    if (!(error instanceof PersonalizationApiError)) {
      return { status: "unavailable", requestId };
    }
    if (error.code === "UNAUTHENTICATED") {
      return { status: "guest", requestId };
    }
    if (error.code === "FORBIDDEN") {
      return { status: "forbidden", requestId };
    }
    if (error.code === "ADMIN_CATALOG_NOT_ENABLED") {
      return { status: "feature_off", requestId };
    }
    return { status: "unavailable", requestId };
  }
}

export function adminCatalogNotEnabledError() {
  return personalizationDomainError({
    code: "ADMIN_CATALOG_NOT_ENABLED",
    status: 403,
    publicMessage: "The administrator catalog is not enabled."
  });
}

function shouldWriteFeatureDeniedEvent(
  routeCategory: AdminCatalogRouteCategory
): boolean {
  return (
    routeCategory.endsWith("_page") ||
    routeCategory === "catalog_menu_api" ||
    routeCategory === "songs_list_api" ||
    routeCategory === "songs_options_api" ||
    routeCategory === "song_detail_api" ||
    routeCategory === "song_duplicate_check_api"
  );
}

function withProtectedCachePolicy(
  response: Response,
  requestId: string
): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-request-id", requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function writeFeatureDeniedEvent(
  event: AdminCatalogFeatureDeniedEvent,
  writer: WriteAdminCatalogFeatureDeniedEvent | undefined
): void {
  try {
    if (writer !== undefined) {
      writer(event);
      return;
    }
    console.warn("[admin-catalog] Catalog feature access denied.", event);
  } catch {
    console.error(
      "[admin-catalog] Failed to write catalog feature denial event."
    );
  }
}
