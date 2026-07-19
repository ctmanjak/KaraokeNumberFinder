import { personalizationError } from "./errors";

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw personalizationError("INVALID_REQUEST");
  }
}

export function requireValidInput<T>(
  input: unknown,
  validator: (input: unknown) => input is T
): T {
  if (!validator(input)) {
    throw personalizationError("VALIDATION_ERROR");
  }

  return input;
}
