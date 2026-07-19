import { personalizationError } from "./errors";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);

export function isMutationMethod(method: string): boolean {
  return MUTATION_METHODS.has(method.toUpperCase());
}

export function validateMutationRequest(
  request: Request,
  trustedOrigin?: string
): void {
  const method = request.method.toUpperCase();

  if (READ_ONLY_METHODS.has(method)) {
    return;
  }

  if (!MUTATION_METHODS.has(method)) {
    throw personalizationError("INVALID_REQUEST");
  }

  if (!isExactOrigin(trustedOrigin)) {
    throw personalizationError("PERSONALIZATION_UNAVAILABLE");
  }

  const origin = request.headers.get("origin");
  if (origin === null || origin === "null" || origin !== trustedOrigin) {
    throw personalizationError("CSRF_REJECTED");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw personalizationError("CSRF_REJECTED");
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw personalizationError("CSRF_REJECTED");
  }

  if (request.headers.get("x-knf-request") !== "1") {
    throw personalizationError("CSRF_REJECTED");
  }
}

function isExactOrigin(value: string | undefined): value is string {
  if (value === undefined || value === "") {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.origin === value;
  } catch {
    return false;
  }
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const parts = value.split(";");
  const mediaType = parts.shift()?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return false;
  }

  if (parts.length === 0) {
    return true;
  }

  if (parts.length !== 1) {
    return false;
  }

  const parameter = parts[0].trim();
  const separator = parameter.indexOf("=");
  if (separator === -1) {
    return false;
  }

  const name = parameter.slice(0, separator).trim().toLowerCase();
  const rawValue = parameter.slice(separator + 1).trim();
  const charset = rawValue.replace(/^"([^"]*)"$/u, "$1").toLowerCase();

  return name === "charset" && charset === "utf-8";
}
