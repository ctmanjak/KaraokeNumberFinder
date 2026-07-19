export type ClientErrorEnvelope = {
  code?: string;
  message?: string;
};

export type RequestTimeout = Readonly<{
  clear: () => void;
  signal: AbortSignal;
}>;

export function createRequestTimeout(timeoutMs: number): RequestTimeout {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    clear: () => clearTimeout(timeoutId),
    signal: controller.signal
  };
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function readErrorEnvelope(value: unknown): ClientErrorEnvelope {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).error !== "object" ||
    (value as Record<string, unknown>).error === null
  ) {
    return {};
  }

  const error = (value as { error: Record<string, unknown> }).error;
  return {
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    ...(typeof error.message === "string" ? { message: error.message } : {})
  };
}
