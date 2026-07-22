"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";

export function useResetAuthNavigationPending(
  setPending: Dispatch<SetStateAction<boolean>>
): void {
  useEffect(() => {
    function handlePageShow(): void {
      setPending(false);
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [setPending]);
}
