import { describe, expect, it } from "vitest";

import {
  findActiveProviderById,
  isDefaultProviderId,
  selectOperationalDefaultProvider
} from "./default-provider";

describe("default provider selection", () => {
  it("prefers active defaults with deterministic order and ignores input order", () => {
    const providers = [
      provider("provider-z", "Zulu", 10, true),
      provider("provider-b", "Beta", 5, true),
      provider("provider-a", "Alpha", 5, true),
      provider("provider-disabled", "Disabled", 0, true, false)
    ];

    expect(selectOperationalDefaultProvider(providers)?.id).toBe("provider-a");
    expect(selectOperationalDefaultProvider([...providers].reverse())?.id).toBe(
      "provider-a"
    );
  });

  it("uses the first active provider when no active default exists", () => {
    const providers = [
      provider("provider-z", "Zulu", 20, false),
      provider("provider-b", "Same", 10, false),
      provider("provider-a", "Same", 10, false)
    ];

    expect(selectOperationalDefaultProvider(providers)?.id).toBe("provider-a");
  });

  it("returns no provider when the active set is empty", () => {
    expect(
      selectOperationalDefaultProvider([
        provider("provider-disabled", "Disabled", 0, true, false)
      ])
    ).toBeUndefined();
  });

  it("finds only active provider IDs", () => {
    const providers = [
      provider("provider-active", "Active", 0, false),
      provider("provider-disabled", "Disabled", 1, false, false)
    ];

    expect(findActiveProviderById(providers, "provider-active")?.id).toBe(
      "provider-active"
    );
    expect(
      findActiveProviderById(providers, "provider-disabled")
    ).toBeUndefined();
  });

  it.each([
    ["valid", "provider-1", true],
    ["empty", "", false],
    ["whitespace", "   ", false],
    ["leading whitespace", " provider", false],
    ["control character", "provider\n", false],
    ["too long", "p".repeat(129), false],
    ["wrong type", 42, false]
  ])("validates %s provider IDs", (_name, value, expected) => {
    expect(isDefaultProviderId(value)).toBe(expected);
  });
});

function provider(
  id: string,
  name: string,
  displayOrder: number,
  isDefault: boolean,
  isActive = true
) {
  return {
    id,
    name,
    is_active: isActive,
    display_order: displayOrder,
    is_default: isDefault
  };
}
