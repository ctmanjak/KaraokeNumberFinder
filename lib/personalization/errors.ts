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

export type PersonalizationSafeCandidateSummary = Readonly<{
  id: string;
  display_title: string;
  canonical_title: string;
  canonical_artist: string;
  original_language: string;
  release_year: number | null;
  tie_in: string | null;
  provider_summary: ReadonlyArray<
    Readonly<{
      provider_id: string;
      provider_name: string;
      karaoke_number: string;
      version_info: string;
    }>
  >;
  match_evidence: ReadonlyArray<
    Readonly<{
      role: "title" | "artist";
      strength: "exact" | "prefix" | "partial";
      input_field: "canonical_title" | "display_title" | "canonical_artist";
      candidate_field: string;
      matched_value: string;
    }>
  >;
  admin_path: string;
}>;

export type PersonalizationErrorDetails = Readonly<{
  issues?: readonly PersonalizationValidationIssue[];
  candidates?: ReadonlyArray<
    Readonly<{ id: string }> | PersonalizationSafeCandidateSummary
  >;
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
        .map(sanitizeCandidate)
        .filter(
          (
            candidate
          ): candidate is
            Readonly<{ id: string }> | PersonalizationSafeCandidateSummary =>
            candidate !== null
        )
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

function sanitizeCandidate(
  value: unknown
): Readonly<{ id: string }> | PersonalizationSafeCandidateSummary | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string"
  ) {
    return null;
  }
  if (!isSafeCandidateSummary(value)) {
    return { id: value.id };
  }
  return {
    id: value.id,
    display_title: value.display_title,
    canonical_title: value.canonical_title,
    canonical_artist: value.canonical_artist,
    original_language: value.original_language,
    release_year: value.release_year,
    tie_in: value.tie_in,
    provider_summary: value.provider_summary.map((entry) => ({
      provider_id: entry.provider_id,
      provider_name: entry.provider_name,
      karaoke_number: entry.karaoke_number,
      version_info: entry.version_info
    })),
    match_evidence: value.match_evidence.map((evidence) => ({
      role: evidence.role,
      strength: evidence.strength,
      input_field: evidence.input_field,
      candidate_field: evidence.candidate_field,
      matched_value: evidence.matched_value
    })),
    admin_path: value.admin_path
  };
}

function isSafeCandidateSummary(
  value: object & Record<"id", unknown>
): value is PersonalizationSafeCandidateSummary {
  return (
    typeof value.id === "string" &&
    "display_title" in value &&
    typeof value.display_title === "string" &&
    "canonical_title" in value &&
    typeof value.canonical_title === "string" &&
    "canonical_artist" in value &&
    typeof value.canonical_artist === "string" &&
    "original_language" in value &&
    typeof value.original_language === "string" &&
    "release_year" in value &&
    (value.release_year === null || typeof value.release_year === "number") &&
    "tie_in" in value &&
    (value.tie_in === null || typeof value.tie_in === "string") &&
    "provider_summary" in value &&
    Array.isArray(value.provider_summary) &&
    value.provider_summary.every(isSafeProviderSummary) &&
    "match_evidence" in value &&
    Array.isArray(value.match_evidence) &&
    value.match_evidence.every(isSafeMatchEvidence) &&
    "admin_path" in value &&
    value.admin_path === `/admin/songs/${encodeURIComponent(value.id)}`
  );
}

function isSafeProviderSummary(value: unknown): value is {
  provider_id: string;
  provider_name: string;
  karaoke_number: string;
  version_info: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider_id" in value &&
    typeof value.provider_id === "string" &&
    "provider_name" in value &&
    typeof value.provider_name === "string" &&
    "karaoke_number" in value &&
    typeof value.karaoke_number === "string" &&
    "version_info" in value &&
    typeof value.version_info === "string"
  );
}

function isSafeMatchEvidence(value: unknown): value is {
  role: "title" | "artist";
  strength: "exact" | "prefix" | "partial";
  input_field: "canonical_title" | "display_title" | "canonical_artist";
  candidate_field: string;
  matched_value: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    (value.role === "title" || value.role === "artist") &&
    "strength" in value &&
    (value.strength === "exact" ||
      value.strength === "prefix" ||
      value.strength === "partial") &&
    "input_field" in value &&
    (value.input_field === "canonical_title" ||
      value.input_field === "display_title" ||
      value.input_field === "canonical_artist") &&
    "candidate_field" in value &&
    typeof value.candidate_field === "string" &&
    "matched_value" in value &&
    typeof value.matched_value === "string"
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
