# Personalization API foundation

This directory is the shared server boundary for the M3 Favorite,
SearchHistory, and UserPreference APIs. Public search and provider routes must
not import it.

## Server route entry point

Protected route files should import `createServerPersonalizationHandler` from
`./server`. The wrapper creates a server request ID, validates mutation CSRF
headers before session lookup, performs an authoritative Better Auth database
session lookup, applies `Cache-Control: private, no-store`, and maps failures to
the common error envelope.

```ts
import {
  parseJsonBody,
  requireOwnedResource,
  requireValidInput
} from "@/lib/personalization";
import { createServerPersonalizationHandler } from "@/lib/personalization/server";

export const DELETE = createServerPersonalizationHandler(
  async ({ request, auth }) => {
    const input = requireValidInput(await parseJsonBody(request), isInput);
    const resource = await requireOwnedResource(
      auth,
      { id: input.id },
      (where) => repository.findOwned(where)
    );

    return Response.json({ id: resource.id });
  }
);
```

The route must never accept a user ID from body, query, or path input. The
repository callback receives a composite identity such as `{ id, userId }` and
must use all fields in the database query. It must not first perform an
unscoped lookup. A missing row and a row owned by another user both become the
same `404 NOT_FOUND` response.

## Pure dependencies for unit tests

- `createRequireSession(getSession)` returns only `{ user: { id } }`; session
  and OAuth tokens are discarded.
- `validateMutationRequest(request, trustedOrigin)` implements the exact
  Origin, Fetch Metadata, JSON content type, and `X-KNF-Request: 1` contract.
- `createPersonalizationHandler(handler, dependencies)` supports database-free
  handler tests with injected session lookup, trusted origin, request ID, and
  safe logger.
- `parseJsonBody` maps malformed JSON to `400 INVALID_REQUEST`, while
  `requireValidInput` maps endpoint validation failures to
  `422 VALIDATION_ERROR`.
- `personalizationError(code)`, `requireActionPermission`, `ownedWhere`, and
  `requireOwnedResource` provide the common error, authorization, and ownership
  contracts without importing a domain service.
- `personalizationDomainError` lets each domain add a fixed safe code, status,
  and public message without editing the shared error map. Its public message
  must never include request data or an internal exception.

`/api/auth/*` continues to use Better Auth's own route defenses and must not be
wrapped with these helpers.
