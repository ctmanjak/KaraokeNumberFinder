import { describe, expect, it } from "vitest";

describe("project scaffold", () => {
  it("runs the test command", () => {
    expect("KaraokeNumberFinder").toContain("Karaoke");
  });
});
