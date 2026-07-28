import { randomUUID } from "node:crypto";

export const PERSONALIZATION_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "CSRF_REJECTED",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "PERSONALIZATION_UNAVAILABLE"
] as const;

export type PersonalizationErrorCode =
  (typeof PERSONALIZATION_ERROR_CODES)[number];

export type PersonalizationHttpStatus =
  400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503;

export type PersonalizationValidationIssue = Readonly<{
  path: string;
  message: string;
  max?: number;
}>;

export type PersonalizationErrorDetails = Readonly<{
  issues?: readonly PersonalizationValidationIssue[];
  candidates?: ReadonlyArray<Readonly<{ id: string }>>;
}>;

type ErrorDefinition = {
  status: PersonalizationHttpStatus;
  message: string;
};

const ERROR_DEFINITIONS: Record<PersonalizationErrorCode, ErrorDefinition> = {
  INVALID_REQUEST: {
    status: 400,
    message: "Request is invalid."
  },
  UNAUTHENTICATED: {
    status: 401,
    message: "Authentication is required."
  },
  FORBIDDEN: {
    status: 403,
    message: "You are not allowed to perform this action."
  },
  CSRF_REJECTED: {
    status: 403,
    message: "Request origin could not be verified."
  },
  NOT_FOUND: {
    status: 404,
    message: "Resource was not found."
  },
  CONFLICT: {
    status: 409,
    message: "Request conflicts with the current state."
  },
  VALIDATION_ERROR: {
    status: 422,
    message: "Request validation failed."
  },
  RATE_LIMITED: {
    status: 429,
    message: "Too many requests."
  },
  PERSONALIZATION_UNAVAILABLE: {
    status: 500,
    message: "Personalization is temporarily unavailable."
  }
};

export class PersonalizationApiError<
  TCode extends string = string
> extends Error {
  readonly code: TCode;
  readonly status: PersonalizationHttpStatus;

  constructor(
    code: TCode,
    status: PersonalizationHttpStatus,
    publicMessage: string,
    readonly details?: PersonalizationErrorDetails
  ) {
    super(publicMessage);
    this.name = "PersonalizationApiError";
    this.code = code;
    this.status = status;
  }
}

export type PersonalizationFailureEvent = Readonly<{
  event: "personalization_api_failure";
  code: string;
  request_id: string;
  status: PersonalizationHttpStatus;
}>;

export type WritePersonalizationSafeLog = (
  event: PersonalizationFailureEvent
) => void;

export type PersonalizationErrorEnvelope = {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: PersonalizationErrorDetails;
  };
};

export function personalizationError(
  code: PersonalizationErrorCode
): PersonalizationApiError<PersonalizationErrorCode> {
  const definition = ERROR_DEFINITIONS[code];
  return new PersonalizationApiError(
    code,
    definition.status,
    definition.message
  );
}

export function personalizationDomainError<TCode extends string>(definition: {
  code: TCode;
  status: PersonalizationHttpStatus;
  publicMessage: string;
  details?: PersonalizationErrorDetails;
}): PersonalizationApiError<TCode> {
  if (
    !/^[A-Z][A-Z0-9_]*$/u.test(definition.code) ||
    definition.publicMessage.trim() === "" ||
    (PERSONALIZATION_ERROR_CODES as readonly string[]).includes(definition.code)
  ) {
    throw new TypeError("Invalid personalization domain error definition.");
  }

  return new PersonalizationApiError(
    definition.code,
    definition.status,
    definition.publicMessage,
    definition.details
  );
}

export function createPersonalizationRequestId(): string {
  return randomUUID();
}

export function createPersonalizationErrorResponse(
  error: unknown,
  options: {
    requestId?: string;
    writeSafeLog?: WritePersonalizationSafeLog;
  } = {}
): Response {
  const apiError =
    error instanceof PersonalizationApiError
      ? error
      : personalizationError("PERSONALIZATION_UNAVAILABLE");
  const requestId = options.requestId ?? createPersonalizationRequestId();
  const event: PersonalizationFailureEvent = {
    event: "personalization_api_failure",
    code: apiError.code,
    request_id: requestId,
    status: apiError.status
  };

  writeFailureEvent(event, options.writeSafeLog);

  const details =
    apiError.details === undefined
      ? undefined
      : sanitizeErrorDetails(apiError.details);
  const body: PersonalizationErrorEnvelope = {
    error: {
      code: apiError.code,
      message: apiError.message,
      request_id: requestId,
      ...(details === undefined ? {} : { details })
    }
  };
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId
  });

  if (apiError.code === "UNAUTHENTICATED") {
    headers.set("www-authenticate", "Session");
  }

  return new Response(JSON.stringify(body), {
    status: apiError.status,
    headers
  });
}

function sanitizeErrorDetails(
  value: PersonalizationErrorDetails
): PersonalizationErrorDetails | undefined {
  const record = value as Record<string, unknown>;
  const issues = Array.isArray(record.issues)
    ? record.issues.filter(isValidationIssue).map((issue) => ({
        path: issue.path,
        message: issue.message,
        ...(typeof issue.max === "number" ? { max: issue.max } : {})
      }))
    : undefined;
  const candidates = Array.isArray(record.candidates)
    ? record.candidates
        .filter(isCandidateReference)
        .map((candidate) => ({ id: candidate.id }))
    : undefined;
  if (issues === undefined && candidates === undefined) return undefined;
  return {
    ...(issues === undefined ? {} : { issues }),
    ...(candidates === undefined ? {} : { candidates })
  };
}

function isValidationIssue(
  value: unknown
): value is PersonalizationValidationIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "message" in value &&
    typeof value.message === "string" &&
    (!("max" in value) || typeof value.max === "number")
  );
}

function isCandidateReference(
  value: unknown
): value is Readonly<{ id: string }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  );
}

function writeFailureEvent(
  event: PersonalizationFailureEvent,
  writer: WritePersonalizationSafeLog | undefined
): void {
  try {
    if (writer !== undefined) {
      writer(event);
      return;
    }

    console.error("[personalization] Protected API request failed.", event);
  } catch {
    console.error(
      "[personalization] Failed to write protected API failure event."
    );
  }
}
