import {
  ownedWhere,
  parseJsonBody,
  personalizationError,
  requireValidInput,
  type PersonalizationRouteHandler
} from "../personalization";
import { isDefaultProviderId } from "../preferences/default-provider";
import type { UserPreferenceService } from "./service";

type DefaultProviderPutBody = Readonly<{
  provider_id: string | null;
}>;

export function createUserPreferenceGetHandler(
  service: UserPreferenceService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    requireNoQueryParameters(request);
    return Response.json(await service.get(ownedWhere(auth, {})));
  };
}

export function createDefaultProviderPutHandler(
  service: UserPreferenceService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    requireNoQueryParameters(request);
    const body = requireValidInput(
      await parseJsonBody(request),
      isDefaultProviderPutBody
    );

    return Response.json(
      await service.setDefaultProvider(
        ownedWhere(auth, { providerId: body.provider_id })
      )
    );
  };
}

function requireNoQueryParameters(request: Request): void {
  if (new URL(request.url).searchParams.size !== 0) {
    throw personalizationError("INVALID_REQUEST");
  }
}

function isDefaultProviderPutBody(
  input: unknown
): input is DefaultProviderPutBody {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    "provider_id" in input &&
    (input.provider_id === null || isDefaultProviderId(input.provider_id))
  );
}
