"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { fetchAdminSongOptions } from "@/lib/admin-song/client";
import type {
  AdminAvailabilityStatus,
  AdminEditableAliasType,
  AdminSongOptions
} from "@/lib/admin-song/types";
import { checkAdminSongDuplicate } from "@/lib/admin-song-duplicate/client";
import type {
  CandidateSummary,
  DuplicateCheckResult
} from "@/lib/admin-song-duplicate/types";
import {
  fetchAdminSongDetail,
  updateAdminSongDetail
} from "@/lib/admin-song-detail/client";
import type {
  AdminSongDetail,
  AdminSongPatchInput
} from "@/lib/admin-song-detail/types";
import { AdminSongClientError } from "@/lib/admin-song/client";
import { normalizeSearchText } from "@/lib/search/normalize";

type SongDraft = {
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  release_year: string;
  tie_in: string;
  source_name: string;
  source_url: string;
  verification_note: string;
};

type AliasDraft = {
  key: string;
  id?: string;
  alias: string;
  language: string;
  alias_type: AdminEditableAliasType;
  source_name: string;
  source_url: string;
  verification_note: string;
};

type EntryDraft = {
  key: string;
  id?: string;
  provider_id: string;
  karaoke_number: string;
  version_info: string;
  availability_status: AdminAvailabilityStatus;
  last_verified_at: string;
  source_name: string;
  source_url: string;
  verification_note: string;
};

type EditDraft = {
  song: SongDraft;
  aliases: AliasDraft[];
  entries: EntryDraft[];
};

type DuplicateState =
  | { status: "idle" }
  | { status: "checking" | "retrying" }
  | ({ status: "none" | "possible" | "exact" } & DuplicateCheckResult)
  | {
      status: "error";
      message: string;
      retryAfter?: string;
    };

export function AdminSongDetailPage({ songId }: Readonly<{ songId: string }>) {
  const auth = useAuth();
  const nextKey = useRef(1);
  const statusRef = useRef<HTMLDivElement>(null);
  const duplicateController = useRef<AbortController | null>(null);
  const duplicateSequence = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualNoAutoRetry = useRef(false);
  const previousFingerprint = useRef("");
  const [detail, setDetail] = useState<AdminSongDetail | null>(null);
  const [options, setOptions] = useState<AdminSongOptions | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "not_found" | "forbidden" | "error"
  >("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [duplicateNonce, setDuplicateNonce] = useState(0);
  const [duplicate, setDuplicate] = useState<DuplicateState>({
    status: "idle"
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [catalogDisabled, setCatalogDisabled] = useState(false);

  const loadIdentity =
    auth.state.status === "authenticated"
      ? `${auth.state.user.id}:${auth.state.user.is_admin}:${reloadKey}`
      : `${auth.state.status}:${reloadKey}`;

  useEffect(() => {
    if (auth.state.status !== "authenticated" || !auth.state.user.is_admin) {
      return;
    }
    const controller = new AbortController();
    queueMicrotask(async () => {
      try {
        const [loadedDetail, loadedOptions] = await Promise.all([
          fetchAdminSongDetail(songId, fetch, controller.signal),
          fetchAdminSongOptions(fetch, controller.signal)
        ]);
        if (controller.signal.aborted) return;
        setDetail(loadedDetail);
        setOptions(loadedOptions);
        setDraft(toDraft(loadedDetail));
        setDuplicate({ status: "idle" });
        setAcknowledged(false);
        setStale(false);
        setCatalogDisabled(false);
        setSaveError(null);
        setLoadState("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof AdminSongClientError) {
          if (error.code === "SONG_NOT_FOUND") {
            setLoadState("not_found");
            return;
          }
          if (error.code === "FORBIDDEN") {
            setLoadState("forbidden");
            return;
          }
          if (error.code === "ADMIN_CATALOG_NOT_ENABLED") {
            setCatalogDisabled(true);
            setLoadState("ready");
            return;
          }
          if (error.code === "UNAUTHENTICATED") auth.markExpired();
        }
        setLoadState("error");
      }
    });
    return () => controller.abort();
    // The authenticated administrator identity and explicit reload are the load triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadIdentity, songId]);

  const dirty = useMemo(
    () =>
      detail !== null &&
      draft !== null &&
      JSON.stringify(draft) !== JSON.stringify(toDraft(detail)),
    [detail, draft]
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const identityChanged =
    detail !== null &&
    draft !== null &&
    (draft.song.original_language !== detail.song.original_language ||
      draft.song.canonical_title !== detail.song.canonical_title ||
      draft.song.display_title !== detail.song.display_title ||
      draft.song.canonical_artist !== detail.song.canonical_artist);
  const canonicalNormalized = normalizeSearchText(
    draft?.song.canonical_title ?? ""
  );
  const artistNormalized = normalizeSearchText(
    draft?.song.canonical_artist ?? ""
  );
  const displayNormalized = normalizeSearchText(
    draft?.song.display_title ?? ""
  );
  const duplicateCanonicalTitle = draft?.song.canonical_title ?? "";
  const duplicateDisplayTitle = draft?.song.display_title ?? "";
  const duplicateCanonicalArtist = draft?.song.canonical_artist ?? "";
  const duplicateInputValid =
    canonicalNormalized !== "" &&
    artistNormalized !== "" &&
    (draft?.song.canonical_title.length ?? 0) <= 512 &&
    (draft?.song.canonical_artist.length ?? 0) <= 512;
  const fingerprint =
    draft === null
      ? ""
      : [
          draft.song.original_language,
          canonicalNormalized,
          displayNormalized,
          artistNormalized
        ].join("\u0000");

  useEffect(() => {
    if (!identityChanged || !duplicateInputValid || catalogDisabled) {
      duplicateController.current?.abort();
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      previousFingerprint.current = fingerprint;
      queueMicrotask(() => {
        setDuplicate({ status: "idle" });
        setAcknowledged(false);
      });
      return;
    }

    const isNewFingerprint = previousFingerprint.current !== fingerprint;
    previousFingerprint.current = fingerprint;
    if (isNewFingerprint) {
      queueMicrotask(() => setAcknowledged(false));
      manualNoAutoRetry.current = false;
    }
    duplicateController.current?.abort();
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    const controller = new AbortController();
    duplicateController.current = controller;
    const sequence = ++duplicateSequence.current;
    const allowAutoRetry = !manualNoAutoRetry.current;
    manualNoAutoRetry.current = false;
    queueMicrotask(() => setDuplicate({ status: "checking" }));

    const run = async (attempt: number) => {
      try {
        const result = await checkAdminSongDuplicate(
          {
            canonical_title: duplicateCanonicalTitle,
            display_title: duplicateDisplayTitle,
            canonical_artist: duplicateCanonicalArtist,
            exclude_song_id: songId
          },
          fetch,
          controller.signal
        );
        if (
          controller.signal.aborted ||
          sequence !== duplicateSequence.current
        ) {
          return;
        }
        setDuplicate({ status: result.classification, ...result });
        setAcknowledged(false);
      } catch (error) {
        if (
          controller.signal.aborted ||
          sequence !== duplicateSequence.current
        ) {
          return;
        }
        if (
          error instanceof AdminSongClientError &&
          error.code === "ADMIN_CATALOG_NOT_ENABLED"
        ) {
          setCatalogDisabled(true);
          setDuplicate({
            status: "error",
            message: duplicateErrorMessage(error)
          });
          return;
        }
        const retryable =
          !(error instanceof AdminSongClientError) ||
          (error.status !== undefined && error.status >= 500);
        if (attempt === 0 && allowAutoRetry && retryable) {
          setDuplicate({ status: "retrying" });
          retryTimer.current = setTimeout(() => {
            void run(1);
          }, 1_000);
          return;
        }
        setDuplicate({
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
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      controller.abort();
    };
  }, [
    catalogDisabled,
    duplicateCanonicalArtist,
    duplicateCanonicalTitle,
    duplicateDisplayTitle,
    duplicateInputValid,
    duplicateNonce,
    fingerprint,
    identityChanged,
    songId
  ]);

  useEffect(() => {
    if (saveError !== null || stale) {
      statusRef.current?.focus();
    }
  }, [saveError, stale]);

  if (auth.state.status === "loading") {
    return <PageState title="관리자 권한을 확인하는 중입니다." />;
  }
  if (auth.state.status !== "authenticated") {
    return <PageState title="로그인이 필요합니다." />;
  }
  if (!auth.state.user.is_admin || loadState === "forbidden") {
    return <PageState title="관리자만 접근할 수 있습니다." error />;
  }
  if (loadState === "loading") {
    return <PageState title="노래 상세를 불러오는 중입니다." />;
  }
  if (loadState === "not_found") {
    return (
      <PageState
        title="노래를 찾을 수 없습니다."
        copy="목록에서 다른 노래를 선택해 주세요."
        error
      />
    );
  }
  if (catalogDisabled && detail === null) {
    return (
      <PageState
        title="관리자 카탈로그가 아직 활성화되지 않았습니다."
        copy="현재 상세 정보를 불러오거나 저장할 수 없습니다."
        error
      />
    );
  }
  if (loadState === "error" || detail === null || draft === null) {
    return (
      <PageState title="노래 상세를 불러오지 못했습니다." error>
        <button
          className="tertiary-button"
          type="button"
          onClick={() => {
            setLoadState("loading");
            setReloadKey((value) => value + 1);
          }}
        >
          다시 시도
        </button>
      </PageState>
    );
  }
  if (options === null) {
    return <PageState title="편집 옵션을 불러오는 중입니다." />;
  }

  const duplicateLocked =
    identityChanged &&
    (duplicate.status === "checking" ||
      duplicate.status === "retrying" ||
      duplicate.status === "error" ||
      duplicate.status === "idle" ||
      duplicate.status === "exact" ||
      (duplicate.status === "possible" && !acknowledged));
  const saveDisabled =
    saving || !dirty || duplicateLocked || catalogDisabled || stale;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled || draft === null || detail === null) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const result = await updateAdminSongDetail(
        songId,
        toPatchInput(
          draft,
          detail.song.updated_at,
          duplicate.status === "possible" && acknowledged
            ? duplicate.candidates.map((candidate) => candidate.id)
            : []
        )
      );
      setDetail(result.detail);
      setDraft(toDraft(result.detail));
      setDuplicate({ status: "idle" });
      setAcknowledged(false);
      setSaveSuccess("변경사항을 저장했습니다.");
      setStale(false);
    } catch (error) {
      if (error instanceof AdminSongClientError) {
        if (error.code === "STALE_SONG") {
          setStale(true);
          setSaveError("다른 관리자가 이 곡을 먼저 수정했습니다.");
        } else if (error.code === "ADMIN_CATALOG_NOT_ENABLED") {
          setCatalogDisabled(true);
          setSaveError(
            "관리자 카탈로그가 비활성화되어 현재 저장할 수 없습니다."
          );
        } else if (
          error.code === "DUPLICATE_SONG" ||
          error.code === "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED"
        ) {
          const candidates = candidatesFromError(error);
          setDuplicate({
            status: error.code === "DUPLICATE_SONG" ? "exact" : "possible",
            classification:
              error.code === "DUPLICATE_SONG" ? "exact" : "possible",
            candidates
          });
          setAcknowledged(false);
          setSaveError(
            error.code === "DUPLICATE_SONG"
              ? "같은 원제와 가수의 곡이 이미 있습니다."
              : "중복 후보가 변경되었습니다. 최신 후보를 확인해 주세요."
          );
        } else {
          setSaveError(saveErrorMessage(error));
        }
      } else {
        setSaveError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="search-shell">
      <div className="mobile-frame admin-frame admin-detail-frame">
        <section
          className="settings-hero admin-list-hero"
          aria-labelledby="admin-song-detail-title"
        >
          <div>
            <p className="eyebrow">Admin</p>
            <h1 id="admin-song-detail-title">{detail.song.display_title}</h1>
            <p className="settings-description">
              곡 정보, 검색 별칭과 제공사 수록 정보를 관리합니다.
            </p>
          </div>
          <Link className="tertiary-button" href="/admin/songs">
            목록으로
          </Link>
        </section>

        {catalogDisabled ? (
          <div className="status-box status-box-error" role="alert">
            <p>
              관리자 카탈로그가 비활성화되어 입력은 유지되지만 저장할 수
              없습니다.
            </p>
            <Link href="/">공개 검색으로</Link>
          </div>
        ) : null}

        <form className="admin-song-form" onSubmit={save}>
          <fieldset className="settings-section" disabled={catalogDisabled}>
            <legend>곡 기본 정보</legend>
            <DraftInput
              id="detail-language"
              label="원어 코드"
              value={draft.song.original_language}
              required
              onChange={(value) =>
                patchSong(setDraft, { original_language: value })
              }
            />
            <DraftInput
              id="detail-canonical-title"
              label="원제"
              value={draft.song.canonical_title}
              required
              onChange={(value) =>
                patchSong(setDraft, { canonical_title: value })
              }
            />
            <DraftInput
              id="detail-display-title"
              label="표시 제목"
              value={draft.song.display_title}
              required
              onChange={(value) =>
                patchSong(setDraft, { display_title: value })
              }
            />
            <DraftInput
              id="detail-artist"
              label="가수"
              value={draft.song.canonical_artist}
              required
              onChange={(value) =>
                patchSong(setDraft, { canonical_artist: value })
              }
            />
            <DraftInput
              id="detail-year"
              label="발매 연도"
              type="number"
              value={draft.song.release_year}
              onChange={(value) => patchSong(setDraft, { release_year: value })}
            />
            <DraftInput
              id="detail-tie-in"
              label="작품/타이인"
              value={draft.song.tie_in}
              onChange={(value) => patchSong(setDraft, { tie_in: value })}
            />
          </fieldset>

          <fieldset className="settings-section" disabled={catalogDisabled}>
            <legend>곡 출처와 검수</legend>
            <DraftInput
              id="detail-source-name"
              label={`출처명${identityChanged ? " (식별 정보 변경 시 필수)" : ""}`}
              value={draft.song.source_name}
              required={identityChanged}
              onChange={(value) => patchSong(setDraft, { source_name: value })}
            />
            <DraftInput
              id="detail-source-url"
              label="출처 URL"
              type="url"
              value={draft.song.source_url}
              onChange={(value) => patchSong(setDraft, { source_url: value })}
            />
            <label className="settings-field" htmlFor="detail-note">
              <span className="field-label">검수 메모</span>
              <textarea
                id="detail-note"
                className="admin-textarea"
                rows={3}
                value={draft.song.verification_note}
                onChange={(event) =>
                  patchSong(setDraft, {
                    verification_note: event.target.value
                  })
                }
              />
            </label>
          </fieldset>

          <fieldset className="settings-section">
            <legend>시스템 별칭 (읽기 전용)</legend>
            {detail.system_aliases.map((alias) => (
              <DraftInput
                key={alias.id}
                id={`system-${alias.id}`}
                label={alias.alias_type}
                value={systemAliasValue(alias.alias_type, draft.song)}
                readOnly
              />
            ))}
          </fieldset>

          <fieldset className="settings-section" disabled={catalogDisabled}>
            <legend>
              관리자 추가 별칭 ({draft.aliases.length}/{detail.limits.aliases})
            </legend>
            {draft.aliases.map((alias, index) => (
              <div className="admin-repeat-card" key={alias.key}>
                <DraftInput
                  id={`alias-${alias.key}-value`}
                  label="별칭"
                  value={alias.alias}
                  required
                  onChange={(value) =>
                    patchAlias(setDraft, index, { alias: value })
                  }
                />
                <DraftInput
                  id={`alias-${alias.key}-language`}
                  label="언어 코드"
                  value={alias.language}
                  required
                  onChange={(value) =>
                    patchAlias(setDraft, index, { language: value })
                  }
                />
                <label
                  className="settings-field"
                  htmlFor={`alias-${alias.key}-type`}
                >
                  <span className="field-label">별칭 유형</span>
                  <select
                    id={`alias-${alias.key}-type`}
                    className="provider-select"
                    value={alias.alias_type}
                    onChange={(event) =>
                      patchAlias(setDraft, index, {
                        alias_type: event.target.value as AdminEditableAliasType
                      })
                    }
                  >
                    {options.alias_types.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <DraftInput
                  id={`alias-${alias.key}-source`}
                  label="별칭 출처명 (선택)"
                  value={alias.source_name}
                  onChange={(value) =>
                    patchAlias(setDraft, index, { source_name: value })
                  }
                />
                <DraftInput
                  id={`alias-${alias.key}-url`}
                  label="별칭 출처 URL (선택)"
                  type="url"
                  value={alias.source_url}
                  onChange={(value) =>
                    patchAlias(setDraft, index, { source_url: value })
                  }
                />
                <DraftInput
                  id={`alias-${alias.key}-note`}
                  label="별칭 검수 메모 (선택)"
                  value={alias.verification_note}
                  onChange={(value) =>
                    patchAlias(setDraft, index, {
                      verification_note: value
                    })
                  }
                />
                <button
                  className="tertiary-button"
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `별칭 “${alias.alias || "새 별칭"}”을 삭제하시겠습니까? 공개 검색 결과에 영향을 줄 수 있습니다.`
                      )
                    ) {
                      setDraft((current) =>
                        current === null
                          ? current
                          : {
                              ...current,
                              aliases: current.aliases.filter(
                                (_, itemIndex) => itemIndex !== index
                              )
                            }
                      );
                    }
                  }}
                >
                  별칭 삭제
                </button>
              </div>
            ))}
            <button
              className="tertiary-button"
              type="button"
              disabled={draft.aliases.length >= detail.limits.aliases}
              onClick={() =>
                setDraft((current) =>
                  current === null
                    ? current
                    : {
                        ...current,
                        aliases: [
                          ...current.aliases,
                          newAlias(`new-${nextKey.current++}`)
                        ]
                      }
                )
              }
            >
              별칭 추가
            </button>
          </fieldset>

          <fieldset className="settings-section" disabled={catalogDisabled}>
            <legend>
              제공사 수록 정보 ({draft.entries.length}/
              {detail.limits.karaoke_entries})
            </legend>
            <p className="form-note">
              기존 수록 행은 삭제하지 않고 상태를 수정합니다.
            </p>
            {draft.entries.map((entry, index) => (
              <EntryEditor
                key={entry.key}
                entry={entry}
                index={index}
                options={options}
                onPatch={(patch) => patchEntry(setDraft, index, patch)}
              />
            ))}
            <button
              className="tertiary-button"
              type="button"
              disabled={
                draft.entries.length >= detail.limits.karaoke_entries ||
                options.providers.length === 0
              }
              onClick={() =>
                setDraft((current) =>
                  current === null
                    ? current
                    : {
                        ...current,
                        entries: [
                          ...current.entries,
                          newEntry(
                            `new-${nextKey.current++}`,
                            options.providers[0].id
                          )
                        ]
                      }
                )
              }
            >
              제공사 수록 정보 추가
            </button>
          </fieldset>

          {identityChanged ? (
            <DuplicatePanel
              state={duplicate}
              acknowledged={acknowledged}
              onAcknowledged={setAcknowledged}
              onRetry={() => {
                manualNoAutoRetry.current = true;
                setDuplicateNonce((value) => value + 1);
              }}
            />
          ) : null}

          {stale || saveError !== null ? (
            <div
              ref={statusRef}
              className="status-box status-box-error"
              role="alert"
              tabIndex={-1}
            >
              <p>{saveError}</p>
              {stale ? (
                <button
                  className="tertiary-button"
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "현재 입력을 버리고 최신 저장 내용을 불러오시겠습니까?"
                      )
                    ) {
                      setLoadState("loading");
                      setReloadKey((value) => value + 1);
                    }
                  }}
                >
                  최신 데이터 다시 불러오기
                </button>
              ) : null}
            </div>
          ) : null}
          {saveSuccess === null ? null : (
            <div className="inline-status" role="status" aria-live="polite">
              <p>{saveSuccess}</p>
              <Link
                href={`/?q=${encodeURIComponent(detail.song.display_title)}`}
              >
                공개 검색에서 확인
              </Link>
            </div>
          )}

          <button
            className="search-button admin-submit"
            type="submit"
            disabled={saveDisabled}
          >
            {saving ? "저장하는 중" : "변경사항 저장"}
          </button>
          <p className="form-note" aria-live="polite">
            {dirty
              ? "저장하지 않은 변경사항이 있습니다."
              : "모든 변경사항이 저장되었습니다."}
          </p>
        </form>
      </div>
    </main>
  );
}

function EntryEditor({
  entry,
  index,
  options,
  onPatch
}: Readonly<{
  entry: EntryDraft;
  index: number;
  options: AdminSongOptions;
  onPatch: (patch: Partial<EntryDraft>) => void;
}>) {
  const confirmed = entry.availability_status !== "unknown";
  const noteRequired =
    entry.availability_status === "not_available" ||
    entry.availability_status === "temporarily_unavailable";
  return (
    <div className="admin-repeat-card">
      <label className="settings-field" htmlFor={`entry-${entry.key}-provider`}>
        <span className="field-label">제공사</span>
        <select
          id={`entry-${entry.key}-provider`}
          className="provider-select"
          value={entry.provider_id}
          onChange={(event) => onPatch({ provider_id: event.target.value })}
        >
          {options.providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} ({provider.country})
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field" htmlFor={`entry-${entry.key}-status`}>
        <span className="field-label">수록 상태</span>
        <select
          id={`entry-${entry.key}-status`}
          className="provider-select"
          value={entry.availability_status}
          onChange={(event) =>
            onPatch({
              availability_status: event.target
                .value as AdminAvailabilityStatus,
              karaoke_number:
                event.target.value === "available" ? entry.karaoke_number : ""
            })
          }
        >
          {options.availability_statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <DraftInput
        id={`entry-${entry.key}-number`}
        label="예약 번호"
        value={entry.karaoke_number}
        required={entry.availability_status === "available"}
        readOnly={entry.availability_status !== "available"}
        onChange={(value) => onPatch({ karaoke_number: value })}
      />
      <DraftInput
        id={`entry-${entry.key}-version`}
        label="버전 정보"
        value={entry.version_info}
        onChange={(value) => onPatch({ version_info: value })}
      />
      <DraftInput
        id={`entry-${entry.key}-verified`}
        label={`마지막 확인일${confirmed ? " (필수)" : " (선택)"}`}
        type="date"
        value={entry.last_verified_at}
        required={confirmed}
        onChange={(value) => onPatch({ last_verified_at: value })}
      />
      <DraftInput
        id={`entry-${entry.key}-source`}
        label="이 행의 출처명 (상태 변경 시 필수)"
        value={entry.source_name}
        required
        onChange={(value) => onPatch({ source_name: value })}
      />
      <DraftInput
        id={`entry-${entry.key}-url`}
        label="이 행의 출처 URL (선택)"
        type="url"
        value={entry.source_url}
        onChange={(value) => onPatch({ source_url: value })}
      />
      <label className="settings-field" htmlFor={`entry-${entry.key}-note`}>
        <span className="field-label">
          검수 메모{noteRequired ? " (필수)" : " (선택)"}
        </span>
        <textarea
          id={`entry-${entry.key}-note`}
          className="admin-textarea"
          rows={2}
          value={entry.verification_note}
          required={noteRequired}
          onChange={(event) =>
            onPatch({ verification_note: event.target.value })
          }
        />
      </label>
      <span className="form-note">수록 행 {index + 1} · 삭제 불가</span>
    </div>
  );
}

function DuplicatePanel({
  state,
  acknowledged,
  onAcknowledged,
  onRetry
}: Readonly<{
  state: DuplicateState;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
  onRetry: () => void;
}>) {
  if (state.status === "idle") {
    return (
      <div className="inline-status" role="status">
        중복 확인을 준비하고 있습니다.
      </div>
    );
  }
  if (state.status === "checking" || state.status === "retrying") {
    return (
      <div className="inline-status" role="status" aria-live="polite">
        {state.status === "checking"
          ? "중복 확인 중…"
          : "중복 확인을 다시 시도하는 중…"}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="status-box status-box-error" role="alert">
        <p>{state.message}</p>
        {state.retryAfter === undefined ? null : (
          <p>다시 시도 가능 시점: {state.retryAfter}</p>
        )}
        <button className="tertiary-button" type="button" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    );
  }
  if (state.status === "none") {
    return (
      <div className="inline-status" role="status">
        중복 후보가 없습니다.
      </div>
    );
  }
  if (state.status !== "possible" && state.status !== "exact") {
    return null;
  }
  return (
    <section
      className={`status-box${state.status === "exact" ? " status-box-error" : ""}`}
      aria-labelledby="duplicate-candidates-title"
    >
      <h2 id="duplicate-candidates-title">
        {state.status === "exact"
          ? "동일 곡이 이미 있습니다"
          : "중복 가능 후보"}
      </h2>
      <ul className="admin-candidate-list">
        {state.candidates.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} />
        ))}
      </ul>
      {state.status === "possible" ? (
        <label className="admin-acknowledgement">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledged(event.target.checked)}
          />
          표시된 후보를 모두 확인했으며 수정 저장
        </label>
      ) : null}
    </section>
  );
}

function CandidateCard({
  candidate
}: Readonly<{ candidate: CandidateSummary }>) {
  return (
    <li className="admin-repeat-card">
      <strong>{candidate.display_title}</strong>
      {candidate.display_title === candidate.canonical_title ? null : (
        <span>원제 {candidate.canonical_title}</span>
      )}
      <span>{candidate.canonical_artist}</span>
      <span>{candidate.original_language}</span>
      {candidate.release_year === null ? null : (
        <span>{candidate.release_year}</span>
      )}
      {candidate.tie_in === null ? null : <span>{candidate.tie_in}</span>}
      <ul aria-label="일치 근거">
        {candidate.match_evidence.map((evidence, index) => (
          <li key={`${evidence.role}-${index}`}>
            {evidence.role} {evidence.strength} · {evidence.candidate_field}
          </li>
        ))}
      </ul>
      <a
        href={`/admin/songs/${encodeURIComponent(candidate.id)}`}
        target="_blank"
        rel="noopener"
        aria-label={`${candidate.display_title} 기존 곡 열기 (새 탭)`}
      >
        기존 곡 열기 (새 탭)
      </a>
    </li>
  );
}

function DraftInput({
  id,
  label,
  value,
  type = "text",
  required,
  readOnly,
  onChange
}: Readonly<{
  id: string;
  label: string;
  value: string;
  type?: string;
  required?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}>) {
  return (
    <label className="settings-field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input
        id={id}
        className="search-input"
        type={type}
        value={value}
        required={required}
        readOnly={readOnly}
        onChange={
          onChange === undefined
            ? undefined
            : (event) => onChange(event.target.value)
        }
      />
    </label>
  );
}

function PageState({
  title,
  copy,
  error = false,
  children
}: Readonly<{
  title: string;
  copy?: string;
  error?: boolean;
  children?: React.ReactNode;
}>) {
  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <section className="settings-hero">
          <p className="eyebrow">Admin</p>
          <h1>노래 상세</h1>
        </section>
        <div
          className={`status-box${error ? " status-box-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <p>{title}</p>
          {copy === undefined ? null : <p>{copy}</p>}
          {children}
        </div>
      </div>
    </main>
  );
}

function toDraft(detail: AdminSongDetail): EditDraft {
  return {
    song: {
      original_language: detail.song.original_language,
      canonical_title: detail.song.canonical_title,
      display_title: detail.song.display_title,
      canonical_artist: detail.song.canonical_artist,
      release_year:
        detail.song.release_year === null
          ? ""
          : String(detail.song.release_year),
      tie_in: detail.song.tie_in ?? "",
      source_name: detail.song.source_name ?? "",
      source_url: detail.song.source_url ?? "",
      verification_note: detail.song.verification_note ?? ""
    },
    aliases: detail.aliases.map((alias) => ({
      key: alias.id,
      id: alias.id,
      alias: alias.alias,
      language: alias.language,
      alias_type: alias.alias_type,
      source_name: alias.source_name ?? "",
      source_url: alias.source_url ?? "",
      verification_note: alias.verification_note ?? ""
    })),
    entries: detail.karaoke_entries.map((entry) => ({
      key: entry.id,
      id: entry.id,
      provider_id: entry.provider_id,
      karaoke_number: entry.karaoke_number,
      version_info: entry.version_info,
      availability_status: entry.availability_status,
      last_verified_at: entry.last_verified_at ?? "",
      source_name: entry.source_name,
      source_url: entry.source_url ?? "",
      verification_note: entry.verification_note ?? ""
    }))
  };
}

function toPatchInput(
  draft: EditDraft,
  expectedUpdatedAt: string,
  acknowledgedIds: readonly string[]
): AdminSongPatchInput {
  return {
    expected_updated_at: expectedUpdatedAt,
    song: {
      original_language: draft.song.original_language,
      canonical_title: draft.song.canonical_title,
      display_title: draft.song.display_title,
      canonical_artist: draft.song.canonical_artist,
      release_year:
        draft.song.release_year.trim() === ""
          ? null
          : Number(draft.song.release_year),
      tie_in: nullable(draft.song.tie_in),
      source_name: nullable(draft.song.source_name),
      source_url: nullable(draft.song.source_url),
      verification_note: nullable(draft.song.verification_note)
    },
    aliases: draft.aliases.map((alias) => ({
      ...(alias.id === undefined ? {} : { id: alias.id }),
      alias: alias.alias,
      language: alias.language,
      alias_type: alias.alias_type,
      source_name: nullable(alias.source_name),
      source_url: nullable(alias.source_url),
      verification_note: nullable(alias.verification_note)
    })),
    karaoke_entries: draft.entries.map((entry) => ({
      ...(entry.id === undefined ? {} : { id: entry.id }),
      provider_id: entry.provider_id,
      karaoke_number: entry.karaoke_number,
      version_info: entry.version_info,
      availability_status: entry.availability_status,
      last_verified_at: nullable(entry.last_verified_at),
      source_name: entry.source_name,
      source_url: nullable(entry.source_url),
      verification_note: nullable(entry.verification_note)
    })),
    possible_duplicate_acknowledged_song_ids: acknowledgedIds
  };
}

function patchSong(
  setDraft: React.Dispatch<React.SetStateAction<EditDraft | null>>,
  patch: Partial<SongDraft>
) {
  setDraft((current) =>
    current === null
      ? current
      : { ...current, song: { ...current.song, ...patch } }
  );
}

function patchAlias(
  setDraft: React.Dispatch<React.SetStateAction<EditDraft | null>>,
  index: number,
  patch: Partial<AliasDraft>
) {
  setDraft((current) =>
    current === null
      ? current
      : {
          ...current,
          aliases: current.aliases.map((alias, itemIndex) =>
            itemIndex === index ? { ...alias, ...patch } : alias
          )
        }
  );
}

function patchEntry(
  setDraft: React.Dispatch<React.SetStateAction<EditDraft | null>>,
  index: number,
  patch: Partial<EntryDraft>
) {
  setDraft((current) =>
    current === null
      ? current
      : {
          ...current,
          entries: current.entries.map((entry, itemIndex) =>
            itemIndex === index ? { ...entry, ...patch } : entry
          )
        }
  );
}

function newAlias(key: string): AliasDraft {
  return {
    key,
    alias: "",
    language: "ko",
    alias_type: "translated_title",
    source_name: "",
    source_url: "",
    verification_note: ""
  };
}

function newEntry(key: string, providerId: string): EntryDraft {
  return {
    key,
    provider_id: providerId,
    karaoke_number: "",
    version_info: "",
    availability_status: "unknown",
    last_verified_at: "",
    source_name: "",
    source_url: "",
    verification_note: ""
  };
}

function systemAliasValue(
  aliasType: "canonical_title" | "display_title" | "artist",
  song: SongDraft
): string {
  if (aliasType === "canonical_title") return song.canonical_title;
  if (aliasType === "display_title") return song.display_title;
  return song.canonical_artist;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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

function saveErrorMessage(error: AdminSongClientError): string {
  if (error.code === "VALIDATION_ERROR") {
    return "필수 입력과 각 행의 출처·확인일·검수 메모를 확인해 주세요.";
  }
  if (error.code === "DUPLICATE_CHECK_UNAVAILABLE") {
    return "중복 확인이 지연되어 전체 변경을 저장하지 않았습니다.";
  }
  if (error.code === "CATALOG_INVARIANT_VIOLATION") {
    return "시스템 별칭 데이터 정리가 필요해 현재 곡을 수정할 수 없습니다.";
  }
  return "저장하지 못했습니다. 입력은 유지됩니다.";
}

function candidatesFromError(error: AdminSongClientError): CandidateSummary[] {
  const payload = error.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("error" in payload) ||
    typeof payload.error !== "object" ||
    payload.error === null ||
    !("details" in payload.error) ||
    typeof payload.error.details !== "object" ||
    payload.error.details === null ||
    !("candidates" in payload.error.details) ||
    !Array.isArray(payload.error.details.candidates)
  ) {
    return [];
  }
  return payload.error.details.candidates as CandidateSummary[];
}
