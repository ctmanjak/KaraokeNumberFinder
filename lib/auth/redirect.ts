import {
  ALLOWED_AUTH_CALLBACK_PATHS,
  type AllowedAuthCallbackPath
} from "./policy";

const allowedPaths = new Set<string>(ALLOWED_AUTH_CALLBACK_PATHS);

export function parseSafeAuthCallbackPath(
  value: unknown
): AllowedAuthCallbackPath | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  if (
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("\0") ||
    value.startsWith("//")
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, "https://callback.invalid");
  } catch {
    return null;
  }

  if (
    parsed.origin !== "https://callback.invalid" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== value ||
    !allowedPaths.has(parsed.pathname)
  ) {
    return null;
  }

  return parsed.pathname as AllowedAuthCallbackPath;
}

export function safeAuthCallbackPathOrHome(
  value: unknown
): AllowedAuthCallbackPath {
  return parseSafeAuthCallbackPath(value) ?? "/";
}
