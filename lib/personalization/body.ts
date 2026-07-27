import { personalizationDomainError, personalizationError } from "./errors";

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw personalizationError("INVALID_REQUEST");
  }
}

export async function parseLimitedJsonBody(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > maxBytes
  ) {
    throw payloadTooLargeError();
  }

  const reader = request.body?.getReader();
  if (reader === undefined) {
    throw personalizationError("INVALID_REQUEST");
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw payloadTooLargeError();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw personalizationError("INVALID_REQUEST");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw personalizationError("INVALID_REQUEST");
  }
}

export function requireJsonContentType(request: Request): void {
  const value = request.headers.get("content-type");
  if (value === null) throw unsupportedMediaTypeError();
  const [mediaType, ...parameters] = value.split(";");
  if (mediaType.trim().toLowerCase() !== "application/json") {
    throw unsupportedMediaTypeError();
  }
  if (parameters.length > 1) throw unsupportedMediaTypeError();
  if (
    parameters.length === 1 &&
    !/^charset\s*=\s*"?utf-8"?$/iu.test(parameters[0].trim())
  ) {
    throw unsupportedMediaTypeError();
  }
}

function payloadTooLargeError() {
  return personalizationDomainError({
    code: "PAYLOAD_TOO_LARGE",
    status: 413,
    publicMessage: "Request payload is too large."
  });
}

function unsupportedMediaTypeError() {
  return personalizationDomainError({
    code: "UNSUPPORTED_MEDIA_TYPE",
    status: 415,
    publicMessage: "Content-Type must be application/json."
  });
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
