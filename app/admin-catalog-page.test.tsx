// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { forbidden } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import Forbidden from "./forbidden";

describe("administrator catalog HTTP forbidden page", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("uses the Next.js interrupt that maps to an actual HTTP 403", () => {
    vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
    let interruption: unknown;
    try {
      forbidden();
    } catch (error) {
      interruption = error;
    }

    expect(interruption).toEqual(
      expect.objectContaining({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" })
    );
  });

  it("has the required accessible heading and safe navigation only", () => {
    render(<Forbidden />);

    expect(
      screen.getByRole("heading", {
        name: "관리자 카탈로그가 아직 활성화되지 않았습니다"
      })
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "홈으로" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "공개 검색으로" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /ADMIN_CATALOG_MODE|email|token|cookie/iu
    );
  });
});
