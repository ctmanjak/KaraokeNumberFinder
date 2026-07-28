import { useCallback, useEffect, useRef, useState } from "react";

import { AdminSongClientError } from "@/lib/admin-song/client";
import { checkAdminSongDuplicate } from "@/lib/admin-song-duplicate/client";
import type { DuplicateCheckResult } from "@/lib/admin-song-duplicate/types";
import { normalizeSearchText } from "@/lib/search/normalize";

export type DuplicateState =
  | { status: "idle" }
  | { status: "invalid"; message: string }
  | { status: "checking" | "retrying" }
  | ({ status: "none" | "possible" | "exact" } & DuplicateCheckResult)
  | {
      status: "error";
      message: string;
      retryAfter?: string;
    };

type DuplicateIdentityInput = Readonly<{
  originalLanguage: string;
  canonicalTitle: string;
  displayTitle: string;
  canonicalArtist: string;
}>;

export function useDuplicateCheck({
  songId,
  identityChanged,
  catalogDisabled,
  identity,
  onCatalogDisabled
}: Readonly<{
  songId: string;
  identityChanged: boolean;
  catalogDisabled: boolean;
  identity: DuplicateIdentityInput;
  onCatalogDisabled: (disabled: boolean) => void;
}>) {
  const controllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualNoAutoRetryRef = useRef(false);
  const previousFingerprintRef = useRef("");
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<DuplicateState>({ status: "idle" });
  const [acknowledged, setAcknowledged] = useState(false);
  const canonicalNormalized = normalizeSearchText(identity.canonicalTitle);
  const displayNormalized = normalizeSearchText(identity.displayTitle);
  const artistNormalized = normalizeSearchText(identity.canonicalArtist);
  const invalidMessage = duplicateInputError(identity);
  const fingerprint = [
    identity.originalLanguage,
    canonicalNormalized,
    displayNormalized,
    artistNormalized
  ].join("\u0000");

  useEffect(() => {
    if (!identityChanged || catalogDisabled || invalidMessage !== null) {
      controllerRef.current?.abort();
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      previousFingerprintRef.current = fingerprint;
      queueMicrotask(() => {
        setState(
          identityChanged && !catalogDisabled && invalidMessage !== null
            ? { status: "invalid", message: invalidMessage }
            : { status: "idle" }
        );
        setAcknowledged(false);
      });
      return;
    }

    const isNewFingerprint = previousFingerprintRef.current !== fingerprint;
    previousFingerprintRef.current = fingerprint;
    if (isNewFingerprint) {
      queueMicrotask(() => setAcknowledged(false));
      manualNoAutoRetryRef.current = false;
    }
    controllerRef.current?.abort();
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    const controller = new AbortController();
    controllerRef.current = controller;
    const sequence = ++sequenceRef.current;
    const allowAutoRetry = !manualNoAutoRetryRef.current;
    manualNoAutoRetryRef.current = false;
    queueMicrotask(() => setState({ status: "checking" }));

    const run = async (attempt: number) => {
      try {
        const result = await checkAdminSongDuplicate(
          {
            canonical_title: identity.canonicalTitle,
            display_title: identity.displayTitle,
            canonical_artist: identity.canonicalArtist,
            exclude_song_id: songId
          },
          fetch,
          controller.signal
        );
        if (controller.signal.aborted || sequence !== sequenceRef.current) {
          return;
        }
        setState({ status: result.classification, ...result });
        setAcknowledged(false);
      } catch (error) {
        if (controller.signal.aborted || sequence !== sequenceRef.current) {
          return;
        }
        if (
          error instanceof AdminSongClientError &&
          error.code === "ADMIN_CATALOG_NOT_ENABLED"
        ) {
          onCatalogDisabled(true);
          setState({
            status: "error",
            message: duplicateErrorMessage(error)
          });
          return;
        }
        const retryable =
          !(error instanceof AdminSongClientError) ||
          (error.status !== undefined && error.status >= 500);
        if (attempt === 0 && allowAutoRetry && retryable) {
          setState({ status: "retrying" });
          retryTimerRef.current = setTimeout(() => {
            void run(1);
          }, 1_000);
          return;
        }
        setState({
          status: "error",
          message: duplicateErrorMessage(error),
          ...(error instanceof AdminSongClientError &&
          error.retryAfter !== null &&
          error.retryAfter !== undefined
            ? { retryAfter: error.retryAfter }
            : {})
        });
      }
    };
    const debounce = setTimeout(() => void run(0), 500);
    return () => {
      clearTimeout(debounce);
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      controller.abort();
    };
  }, [
    catalogDisabled,
    fingerprint,
    identity.canonicalArtist,
    identity.canonicalTitle,
    identity.displayTitle,
    identityChanged,
    invalidMessage,
    nonce,
    onCatalogDisabled,
    songId
  ]);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    sequenceRef.current += 1;
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    manualNoAutoRetryRef.current = false;
    previousFingerprintRef.current = "";
    setState({ status: "idle" });
    setAcknowledged(false);
  }, []);

  const retry = useCallback(() => {
    manualNoAutoRetryRef.current = true;
    setNonce((value) => value + 1);
  }, []);

  return {
    state,
    acknowledged,
    setAcknowledged,
    reset,
    retry
  };
}

export function duplicateInputError(
  identity: DuplicateIdentityInput
): string | null {
  for (const [subject, value] of [
    ["원제는", identity.canonicalTitle],
    ["표시 제목은", identity.displayTitle],
    ["가수는", identity.canonicalArtist]
  ] as const) {
    if (Array.from(value.trim()).length > 512) {
      return `${subject} 512자 이하로 입력해 주세요.`;
    }
  }
  if (normalizeSearchText(identity.canonicalTitle) === "") {
    return "원제에 검색 가능한 문자를 입력해 주세요.";
  }
  if (identity.displayTitle.trim() === "") {
    return "표시 제목을 입력해 주세요.";
  }
  if (normalizeSearchText(identity.canonicalArtist) === "") {
    return "가수에 검색 가능한 문자를 입력해 주세요.";
  }
  return null;
}

function duplicateErrorMessage(error: unknown): string {
  if (error instanceof AdminSongClientError) {
    if (error.status === 429) {
      return "중복 확인 요청이 제한되었습니다. 안내된 시간 이후 다시 시도해 주세요.";
    }
    if (error.code === "ADMIN_CATALOG_NOT_ENABLED") {
      return "관리자 카탈로그가 비활성화되었습니다.";
    }
    if (error.status !== undefined && error.status < 500) {
      return "중복 확인 요청을 처리할 수 없습니다. 입력과 권한을 확인해 주세요.";
    }
  }
  return "중복 확인에 실패했습니다.";
}
