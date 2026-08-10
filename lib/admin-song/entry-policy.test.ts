import { describe, expect, it } from "vitest";

import {
  adminSongServiceDate,
  validateAdminKaraokeEntryPolicy
} from "./entry-policy";

describe("shared administrator karaoke entry policy", () => {
  it("uses the KST service date across the UTC crossover", () => {
    const currentDate = new Date("2026-07-27T15:30:00.000Z");

    expect(adminSongServiceDate(currentDate)).toBe("2026-07-28");
    expect(() =>
      validateAdminKaraokeEntryPolicy({
        availabilityStatus: "available",
        karaokeNumber: "28822",
        lastVerifiedAt: "2026-07-28",
        verificationNote: null,
        currentDate,
        path: "karaoke_entries.0"
      })
    ).not.toThrow();
    expect(() =>
      validateAdminKaraokeEntryPolicy({
        availabilityStatus: "available",
        karaokeNumber: "28822",
        lastVerifiedAt: "2026-07-29",
        verificationNote: null,
        currentDate,
        path: "karaoke_entries.0"
      })
    ).toThrowError(
      expect.objectContaining({
        details: {
          issues: [
            expect.objectContaining({
              path: "karaoke_entries.0.last_verified_at"
            })
          ]
        }
      })
    );
  });

  it("requires an explicit verified date when a confirmed status changes", () => {
    expect(() =>
      validateAdminKaraokeEntryPolicy({
        availabilityStatus: "available",
        karaokeNumber: "28822",
        lastVerifiedAt: "2026-07-28",
        verificationNote: null,
        currentDate: new Date("2026-07-28T12:00:00.000Z"),
        path: "karaoke_entries.0",
        requireExplicitVerifiedDate: true,
        hasExplicitVerifiedDate: false
      })
    ).toThrowError(
      expect.objectContaining({
        details: {
          issues: [
            expect.objectContaining({
              path: "karaoke_entries.0.last_verified_at"
            })
          ]
        }
      })
    );
  });

  it("enforces the shared status, number, date, and note rules", () => {
    const currentDate = new Date("2026-07-28T12:00:00.000Z");

    for (const { expectedPath, ...input } of [
      {
        availabilityStatus: "available" as const,
        karaokeNumber: "",
        lastVerifiedAt: "2026-07-28",
        verificationNote: null,
        expectedPath: "karaoke_entries.0.karaoke_number"
      },
      {
        availabilityStatus: "not_available" as const,
        karaokeNumber: "28822",
        lastVerifiedAt: "2026-07-28",
        verificationNote: "Not listed",
        expectedPath: "karaoke_entries.0.karaoke_number"
      },
      {
        availabilityStatus: "temporarily_unavailable" as const,
        karaokeNumber: "",
        lastVerifiedAt: "2026-07-28",
        verificationNote: null,
        expectedPath: "karaoke_entries.0.verification_note"
      },
      {
        availabilityStatus: "available" as const,
        karaokeNumber: "28822",
        lastVerifiedAt: null,
        verificationNote: null,
        expectedPath: "karaoke_entries.0.last_verified_at"
      }
    ]) {
      expect(() =>
        validateAdminKaraokeEntryPolicy({
          ...input,
          currentDate,
          path: "karaoke_entries.0"
        })
      ).toThrowError(
        expect.objectContaining({
          details: {
            issues: [expect.objectContaining({ path: expectedPath })]
          }
        })
      );
    }
  });
});
