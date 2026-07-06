export type SearchTimingRecorder = {
  record(name: string, durationMs: number): void;
};

export type SearchTimingEvent = {
  name: string;
  duration_ms: number;
};

export function createTimingRecorder(): {
  recorder: SearchTimingRecorder;
  timings: SearchTimingEvent[];
} {
  const timings: SearchTimingEvent[] = [];

  return {
    recorder: {
      record(name: string, durationMs: number) {
        timings.push(roundTiming({ name, duration_ms: durationMs }));
      }
    },
    timings
  };
}

export async function measureAsync<T>(
  timing: SearchTimingRecorder | undefined,
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  if (timing === undefined) {
    return fn();
  }

  const startedAt = performance.now();

  try {
    return await fn();
  } finally {
    timing.record(name, performance.now() - startedAt);
  }
}

export function measureSync<T>(
  timing: SearchTimingRecorder | undefined,
  name: string,
  fn: () => T
): T {
  if (timing === undefined) {
    return fn();
  }

  const startedAt = performance.now();

  try {
    return fn();
  } finally {
    timing.record(name, performance.now() - startedAt);
  }
}

export function roundTiming(timing: SearchTimingEvent): SearchTimingEvent {
  return {
    name: timing.name,
    duration_ms: Math.round(timing.duration_ms * 100) / 100
  };
}
