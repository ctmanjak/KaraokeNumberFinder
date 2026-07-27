import {
  PersonalizationApiError,
  type PersonalizationValidationIssue
} from "../personalization";

export function adminSongValidationError(
  path: string,
  message = "Invalid value.",
  metadata: Readonly<Record<string, string | number>> = {}
): PersonalizationApiError<"VALIDATION_ERROR"> {
  const issue: PersonalizationValidationIssue = {
    path,
    message,
    ...metadata
  };
  return new PersonalizationApiError(
    "VALIDATION_ERROR",
    422,
    "Request validation failed.",
    { issues: [issue] }
  );
}
