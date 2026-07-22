export const PENDING_FAVORITE_STORAGE_KEY = "knf.pending-favorite.v1";
export const PENDING_FAVORITE_VERSION = 1;
export const PENDING_FAVORITE_TTL_MS = 10 * 60 * 1_000;

const SONG_ID_MAX_LENGTH = 128;

export type PendingFavoriteStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type PendingFavoriteIntent = Readonly<{
  version: typeof PENDING_FAVORITE_VERSION;
  song_id: string;
  expires_at: number;
}>;

export function writePendingFavoriteIntent(
  songId: string,
  options: {
    storage?: PendingFavoriteStorage;
    now?: () => number;
    ttlMs?: number;
  } = {}
): boolean {
  if (!isSongId(songId)) {
    return false;
  }

  const storage = options.storage ?? getBrowserPendingFavoriteStorage();
  if (storage === undefined) {
    return false;
  }

  const now = options.now?.() ?? Date.now();
  const requestedTtl = options.ttlMs ?? PENDING_FAVORITE_TTL_MS;
  const ttl = Math.min(PENDING_FAVORITE_TTL_MS, Math.max(1, requestedTtl));
  const intent: PendingFavoriteIntent = {
    version: PENDING_FAVORITE_VERSION,
    song_id: songId,
    expires_at: now + ttl
  };

  try {
    storage.setItem(PENDING_FAVORITE_STORAGE_KEY, JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}

export function readPendingFavoriteIntent(
  options: {
    storage?: PendingFavoriteStorage;
    now?: () => number;
  } = {}
): PendingFavoriteIntent | null {
  const storage = options.storage ?? getBrowserPendingFavoriteStorage();
  if (storage === undefined) {
    return null;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(PENDING_FAVORITE_STORAGE_KEY);
  } catch {
    return null;
  }

  if (raw === null) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    safeRemove(storage);
    return null;
  }

  const now = options.now?.() ?? Date.now();
  if (!isPendingFavoriteIntent(value, now)) {
    safeRemove(storage);
    return null;
  }

  return value;
}

export function clearPendingFavoriteIntent(
  storage:
    PendingFavoriteStorage | undefined = getBrowserPendingFavoriteStorage()
): boolean {
  if (storage === undefined) {
    return false;
  }

  try {
    storage.removeItem(PENDING_FAVORITE_STORAGE_KEY);
    return true;
  } catch {
    try {
      // An invalid tombstone prevents a stale intent from being replayed when
      // removeItem is blocked but writes are still available.
      storage.setItem(PENDING_FAVORITE_STORAGE_KEY, "");
      return true;
    } catch {
      return false;
    }
  }
}

export function getBrowserPendingFavoriteStorage():
  PendingFavoriteStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isPendingFavoriteIntent(
  value: unknown,
  now: number
): value is PendingFavoriteIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const intent = value as Record<string, unknown>;
  return (
    Object.keys(intent).length === 3 &&
    intent.version === PENDING_FAVORITE_VERSION &&
    isSongId(intent.song_id) &&
    typeof intent.expires_at === "number" &&
    Number.isSafeInteger(intent.expires_at) &&
    intent.expires_at > now &&
    intent.expires_at <= now + PENDING_FAVORITE_TTL_MS
  );
}

function isSongId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SONG_ID_MAX_LENGTH &&
    !value.includes("/") &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function safeRemove(storage: PendingFavoriteStorage): void {
  try {
    storage.removeItem(PENDING_FAVORITE_STORAGE_KEY);
  } catch {
    // A storage failure must not prevent the rest of the page from rendering.
  }
}
