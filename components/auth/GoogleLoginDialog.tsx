"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

type GoogleLoginDialogProps = Readonly<{
  error: string | null;
  intent: "add" | "reauthenticate";
  isSubmitting: boolean;
  reason: "guest" | "expired";
  onCancel: () => void;
  onLogin: () => void;
}>;

export function GoogleLoginDialog({
  error,
  intent,
  isSubmitting,
  reason,
  onCancel,
  onLogin
}: GoogleLoginDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const loginButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    loginButtonRef.current?.focus();

    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      if (!isSubmitting) {
        event.preventDefault();
        onCancel();
      }
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableButtons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)"
      ) ?? []
    );
    const firstButton = focusableButtons.at(0);
    const lastButton = focusableButtons.at(-1);

    if (firstButton === undefined || lastButton === undefined) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      firstButton.focus();
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
        aria-describedby="login-dialog-description"
        onKeyDown={handleKeyDown}
      >
        <h2 id="login-dialog-title">
          {reason === "expired"
            ? "세션이 만료되었습니다"
            : "로그인이 필요합니다"}
        </h2>
        <p id="login-dialog-description">
          {intent === "add"
            ? "Google로 로그인하면 선택한 곡을 즐겨찾기에 추가하고 즐겨찾기 화면으로 이동합니다."
            : "Google로 다시 로그인한 뒤 즐겨찾기 해제를 다시 시도해 주세요."}
        </p>
        {error === null ? null : (
          <p className="form-note form-note-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            ref={loginButtonRef}
            className="secondary-button"
            type="button"
            disabled={isSubmitting}
            onClick={onLogin}
          >
            {isSubmitting ? "로그인 준비 중" : "Google로 로그인"}
          </button>
          <button
            className="tertiary-button"
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            취소
          </button>
        </div>
      </section>
    </div>
  );
}
