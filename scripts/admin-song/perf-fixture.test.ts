import { describe, expect, it } from "vitest";

import { requireRomanizedTitleAlias } from "./perf-fixture";

describe("administrator performance fixtures", () => {
  it("requires the saved romanized-title alias", () => {
    expect(requireRomanizedTitleAlias([{ alias: "Saved alias" }])).toBe(
      "Saved alias"
    );
    expect(() => requireRomanizedTitleAlias([])).toThrow(
      "Missing perf fixture romanized_title alias."
    );
  });
});
