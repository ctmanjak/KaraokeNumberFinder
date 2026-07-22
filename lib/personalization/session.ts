import { PersonalizationApiError, personalizationError } from "./errors";

export type AuthContext = Readonly<{
  user: Readonly<{
    id: string;
  }>;
}>;

export type AuthoritativeSessionLookup = (input: {
  headers: Headers;
  query: {
    disableCookieCache: true;
    disableRefresh: true;
  };
}) => Promise<unknown>;

export type RequireSession = (request: Request) => Promise<AuthContext>;

export function createRequireSession(
  getSession: AuthoritativeSessionLookup
): RequireSession {
  return async function requireSession(request: Request): Promise<AuthContext> {
    let result: unknown;

    try {
      result = await getSession({
        headers: request.headers,
        query: {
          disableCookieCache: true,
          disableRefresh: true
        }
      });
    } catch (error) {
      if (error instanceof PersonalizationApiError) {
        throw error;
      }

      throw personalizationError("PERSONALIZATION_UNAVAILABLE");
    }

    if (result === null) {
      throw personalizationError("UNAUTHENTICATED");
    }

    const userId = readUserId(result);
    if (userId === null) {
      throw personalizationError("PERSONALIZATION_UNAVAILABLE");
    }

    return {
      user: {
        id: userId
      }
    };
  };
}

function readUserId(result: unknown): string | null {
  if (
    typeof result !== "object" ||
    result === null ||
    !("session" in result) ||
    !("user" in result)
  ) {
    return null;
  }

  const session = result.session;
  const user = result.user;
  if (
    typeof session !== "object" ||
    session === null ||
    !("userId" in session) ||
    typeof user !== "object" ||
    user === null ||
    !("id" in user)
  ) {
    return null;
  }

  if (
    typeof session.userId !== "string" ||
    session.userId === "" ||
    typeof user.id !== "string" ||
    user.id !== session.userId
  ) {
    return null;
  }

  return session.userId;
}
