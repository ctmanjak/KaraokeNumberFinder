import type { AdminAvailabilityStatus } from "./types";
import { adminSongValidationError } from "./validation";

export function adminSongServiceDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

export function validateAdminKaraokeEntryPolicy({
  availabilityStatus,
  karaokeNumber,
  lastVerifiedAt,
  verificationNote,
  currentDate,
  path,
  requireExplicitVerifiedDate = false,
  hasExplicitVerifiedDate = true
}: Readonly<{
  availabilityStatus: AdminAvailabilityStatus;
  karaokeNumber: string;
  lastVerifiedAt: string | null;
  verificationNote: string | null;
  currentDate: Date;
  path: string;
  requireExplicitVerifiedDate?: boolean;
  hasExplicitVerifiedDate?: boolean;
}>): void {
  if (
    lastVerifiedAt !== null &&
    lastVerifiedAt > adminSongServiceDate(currentDate)
  ) {
    throw adminSongValidationError(`${path}.last_verified_at`);
  }
  if (
    availabilityStatus !== "unknown" &&
    (lastVerifiedAt === null ||
      (requireExplicitVerifiedDate && !hasExplicitVerifiedDate))
  ) {
    throw adminSongValidationError(
      `${path}.last_verified_at`,
      "A confirmed status requires a verified date."
    );
  }
  if (
    (availabilityStatus === "available" && karaokeNumber === "") ||
    (availabilityStatus !== "available" && karaokeNumber !== "")
  ) {
    throw adminSongValidationError(`${path}.karaoke_number`);
  }
  if (
    (availabilityStatus === "not_available" ||
      availabilityStatus === "temporarily_unavailable") &&
    (verificationNote === null || verificationNote.trim() === "")
  ) {
    throw adminSongValidationError(
      `${path}.verification_note`,
      "This status requires a verification note."
    );
  }
}
