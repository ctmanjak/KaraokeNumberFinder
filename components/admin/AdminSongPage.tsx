"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  AdminSongClientError,
  createAdminSong,
  fetchAdminSongOptions
} from "@/lib/admin-song/client";
import { checkAdminSongDuplicate } from "@/lib/admin-song-duplicate/client";
import type {
  CandidateSummary,
  DuplicateCheckResult
} from "@/lib/admin-song-duplicate/types";
import type {
  AdminAvailabilityStatus,
  AdminEditableAliasType,
  AdminSongInput,
  AdminSongOptions
} from "@/lib/admin-song/types";
import { useDuplicateCheck, type DuplicateState } from "./useDuplicateCheck";

type AliasDraft = {
  key: number;
  alias: string;
  language: string;
  alias_type: AdminEditableAliasType;
  source_name: string;
  source_url: string;
};

type EntryDraft = {
  key: number;
  provider_id: string;
  karaoke_number: string;
  version_info: string;
  availability_status: AdminAvailabilityStatus;
  last_verified_at: string;
  source_name: string;
  source_url: string;
  verification_note: string;
};

type IdentityDraft = {
  canonicalTitle: string;
  displayTitle: string;
  canonicalArtist: string;
};

type RecoveryState =
  | { status: "checking"; snapshot: AdminSongInput }
  | { status: "failed"; snapshot: AdminSongInput }
  | {
      status: "exact";
      snapshot: AdminSongInput;
      candidates: readonly CandidateSummary[];
      ambiguous: boolean;
    }
  | {
      status: "none";
      snapshot: AdminSongInput;
      candidates: readonly CandidateSummary[];
    }
  | {
      status: "possible";
      snapshot: AdminSongInput;
      candidates: readonly CandidateSummary[];
      acknowledged: boolean;
    };

export function AdminSongPage({
  navigateToDetail = (url) => window.location.assign(url)
}: Readonly<{ navigateToDetail?: (url: string) => void }>) {
  const auth = useAuth();
  const nextKey = useRef(2);
  const submitInFlight = useRef(false);
  const [options, setOptions] = useState<AdminSongOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [catalogNotEnabled, setCatalogNotEnabled] = useState<
    "load" | "submit" | null
  >(null);
  const [identity, setIdentity] = useState<IdentityDraft>({
    canonicalTitle: "",
    displayTitle: "",
    canonicalArtist: ""
  });
  const [aliases, setAliases] = useState<AliasDraft[]>([]);
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const disableCatalog = useCallback(() => {
    setCatalogNotEnabled("submit");
  }, []);
  const {
    state: duplicate,
    acknowledged,
    setAcknowledged,
    fieldMessages,
    retry: retryDuplicate
  } = useDuplicateCheck({
    identityChanged: true,
    catalogDisabled: catalogNotEnabled !== null,
    identity: {
      originalLanguage: "",
      ...identity
    },
    onCatalogDisabled: disableCatalog
  });
  const optionsLoadIdentity =
    auth.state.status === "authenticated"
      ? `${auth.state.user.id}:${auth.state.user.is_admin}`
      : auth.state.status;

  useEffect(() => {
    if (auth.state.status !== "authenticated" || !auth.state.user.is_admin) {
      return;
    }
    const controller = new AbortController();
    queueMicrotask(async () => {
      try {
        const loaded = await fetchAdminSongOptions(fetch, controller.signal);
        if (controller.signal.aborted) return;
        setOptions(loaded);
        setEntries((current) =>
          current.length > 0 || loaded.providers.length === 0
            ? current
            : [newEntry(1, loaded.providers[0].id)]
        );
        setCatalogNotEnabled(null);
        setLoadError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isAdminCatalogNotEnabled(error)) {
          setCatalogNotEnabled("load");
          setLoadError(null);
        } else {
          setLoadError(messageForError(error));
        }
      }
    });
    return () => controller.abort();
    // The authenticated administrator identity is the only options-load trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsLoadIdentity]);

  if (auth.state.status === "loading") {
    return <AdminState title="권한을 확인하는 중입니다." />;
  }
  if (auth.state.status !== "authenticated") {
    return (
      <AdminState
        title="로그인이 필요합니다."
        copy="상단의 Google 로그인 버튼으로 관리자 계정에 로그인해 주세요."
      />
    );
  }
  if (!auth.state.user.is_admin) {
    return (
      <AdminState
        title="관리자만 접근할 수 있습니다."
        copy="이 계정에는 노래를 추가할 권한이 없습니다."
        error
      />
    );
  }
  if (catalogNotEnabled === "load") {
    return <CatalogNotEnabledPage />;
  }
  if (loadError !== null) {
    return <AdminState title={loadError} error />;
  }
  if (options === null) {
    return <AdminState title="입력 항목을 불러오는 중입니다." />;
  }
  if (options.providers.length === 0) {
    return (
      <AdminState
        title="활성 노래방 제공사가 없습니다."
        copy="노래를 추가하기 전에 활성 제공사를 등록해 주세요."
        error
      />
    );
  }

  const duplicateAllowsCreate =
    duplicate.status === "none" ||
    (duplicate.status === "possible" && acknowledged);
  const recoveryLocksForm = recovery !== null;
  const interactionLocked =
    submitting || recoveryLocksForm || catalogNotEnabled === "submit";
  const createDisabled =
    !duplicateAllowsCreate ||
    submitting ||
    recoveryLocksForm ||
    catalogNotEnabled === "submit";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      createDisabled ||
      submitInFlight.current ||
      options === null ||
      catalogNotEnabled !== null
    ) {
      return;
    }
    const snapshot = buildSnapshot(
      new FormData(event.currentTarget),
      identity,
      aliases,
      entries,
      duplicate.status === "possible" && acknowledged
        ? duplicate.candidates.map((candidate) => candidate.id)
        : undefined
    );
    await submitSnapshot(snapshot);
  }

  async function submitSnapshot(snapshot: AdminSongInput) {
    if (submitInFlight.current || catalogNotEnabled !== null) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    let navigationStarted = false;
    try {
      const result = await createAdminSong(snapshot);
      navigationStarted = true;
      try {
        navigateToDetail(`/admin/songs/${encodeURIComponent(result.song.id)}`);
      } catch (error) {
        navigationStarted = false;
        throw error;
      }
    } catch (error) {
      if (isAdminCatalogNotEnabled(error)) {
        setCatalogNotEnabled("submit");
        setRecovery(null);
      } else if (
        error instanceof AdminSongClientError &&
        error.code === "DUPLICATE_SONG"
      ) {
        setRecovery({
          status: "exact",
          snapshot,
          candidates: candidatesFromError(error),
          ambiguous: false
        });
      } else if (
        error instanceof AdminSongClientError &&
        error.code === "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED"
      ) {
        setRecovery({
          status: "possible",
          snapshot,
          candidates: candidatesFromError(error),
          acknowledged: false
        });
      } else if (isAmbiguousCreateError(error)) {
        setRecovery({ status: "checking", snapshot });
        await recoverCreateState(snapshot);
      } else {
        setSubmitError(messageForError(error));
      }
    } finally {
      if (!navigationStarted) {
        setSubmitting(false);
        submitInFlight.current = false;
      }
    }
  }

  async function recoverCreateState(snapshot: AdminSongInput) {
    try {
      const result = await checkAdminSongDuplicate({
        canonical_title: snapshot.canonical_title,
        display_title: snapshot.display_title,
        canonical_artist: snapshot.canonical_artist
      });
      setRecovery(recoveryFromDuplicateResult(snapshot, result));
    } catch (error) {
      if (isAdminCatalogNotEnabled(error)) {
        setCatalogNotEnabled("submit");
        setRecovery(null);
        return;
      }
      setRecovery({ status: "failed", snapshot });
    }
  }

  return (
    <main className="search-shell">
      <div className="mobile-frame admin-frame">
        <section className="settings-hero" aria-labelledby="admin-song-title">
          <p className="eyebrow">Admin</p>
          <h1 id="admin-song-title">노래 추가</h1>
          <p className="settings-description">
            중복 후보를 확인한 뒤 곡 정보와 제공사별 번호를 등록합니다.
          </p>
        </section>

        {catalogNotEnabled === "submit" ? <CatalogNotEnabledNotice /> : null}

        <form className="admin-song-form" onSubmit={handleSubmit}>
          <fieldset className="settings-section" disabled={interactionLocked}>
            <legend>곡 기본 정보</legend>
            <TextField
              name="original_language"
              label="원어 코드"
              defaultValue="ja"
              required
            />
            <TextField
              name="canonical_title"
              label="원제"
              value={identity.canonicalTitle}
              onChange={(canonicalTitle) =>
                setIdentity((current) => ({ ...current, canonicalTitle }))
              }
              error={fieldMessages.canonical_title}
              required
            />
            <TextField
              name="display_title"
              label="표시 제목"
              value={identity.displayTitle}
              onChange={(displayTitle) =>
                setIdentity((current) => ({ ...current, displayTitle }))
              }
              error={fieldMessages.display_title}
              required
            />
            <TextField
              name="canonical_artist"
              label="가수"
              value={identity.canonicalArtist}
              onChange={(canonicalArtist) =>
                setIdentity((current) => ({ ...current, canonicalArtist }))
              }
              error={fieldMessages.canonical_artist}
              required
            />
            <TextField
              name="release_year"
              label="발매 연도"
              type="number"
              min="1000"
              max="9999"
            />
            <TextField name="tie_in" label="작품/타이인" />
          </fieldset>

          <DuplicatePanel
            state={duplicate}
            acknowledged={acknowledged}
            onAcknowledged={setAcknowledged}
            onRetry={retryDuplicate}
          />

          <fieldset className="settings-section" disabled={interactionLocked}>
            <legend>곡 출처</legend>
            <TextField name="source_name" label="출처명" required />
            <TextField name="source_url" label="출처 URL" type="url" />
          </fieldset>

          <fieldset className="settings-section" disabled={interactionLocked}>
            <legend>추가 검색 별칭</legend>
            <p className="form-note">
              원제, 표시 제목, 가수 별칭은 자동 생성됩니다. {aliases.length}/ 30
            </p>
            {aliases.map((alias, index) => (
              <div className="admin-repeat-card" key={alias.key}>
                <TextField
                  label="별칭"
                  value={alias.alias}
                  onChange={(value) => updateAlias(index, { alias: value })}
                  required
                />
                <TextField
                  label="언어 코드"
                  value={alias.language}
                  onChange={(value) => updateAlias(index, { language: value })}
                  required
                />
                <label className="settings-field">
                  <span className="field-label">별칭 유형</span>
                  <select
                    className="provider-select"
                    value={alias.alias_type}
                    onChange={(event) =>
                      updateAlias(index, {
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
                <TextField
                  label="별칭 출처명"
                  value={alias.source_name}
                  onChange={(value) =>
                    updateAlias(index, { source_name: value })
                  }
                />
                <TextField
                  label="별칭 출처 URL"
                  type="url"
                  value={alias.source_url}
                  onChange={(value) =>
                    updateAlias(index, { source_url: value })
                  }
                />
                <button
                  className="tertiary-button"
                  type="button"
                  onClick={() =>
                    setAliases((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                >
                  별칭 삭제
                </button>
              </div>
            ))}
            <button
              className="tertiary-button"
              type="button"
              disabled={aliases.length >= 30}
              onClick={() => {
                const key = nextKey.current++;
                setAliases((current) => [
                  ...current,
                  {
                    key,
                    alias: "",
                    language: "ko",
                    alias_type: "translated_title",
                    source_name: "",
                    source_url: ""
                  }
                ]);
              }}
            >
              별칭 추가
            </button>
          </fieldset>

          <fieldset className="settings-section" disabled={interactionLocked}>
            <legend>노래방 번호</legend>
            <p className="form-note">{entries.length}/20</p>
            {entries.map((entry, index) => (
              <div className="admin-repeat-card" key={entry.key}>
                <label className="settings-field">
                  <span className="field-label">제공사</span>
                  <select
                    className="provider-select"
                    value={entry.provider_id}
                    onChange={(event) =>
                      updateEntry(index, { provider_id: event.target.value })
                    }
                  >
                    {options.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} ({provider.country})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span className="field-label">수록 상태</span>
                  <select
                    className="provider-select"
                    value={entry.availability_status}
                    onChange={(event) =>
                      updateEntry(index, {
                        availability_status: event.target
                          .value as AdminAvailabilityStatus,
                        karaoke_number:
                          event.target.value === "available"
                            ? entry.karaoke_number
                            : ""
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
                <TextField
                  label="예약 번호"
                  value={entry.karaoke_number}
                  onChange={(value) =>
                    updateEntry(index, { karaoke_number: value })
                  }
                  required={entry.availability_status === "available"}
                  disabled={entry.availability_status !== "available"}
                />
                <TextField
                  label="버전 정보"
                  value={entry.version_info}
                  onChange={(value) =>
                    updateEntry(index, { version_info: value })
                  }
                />
                <TextField
                  label="마지막 확인일"
                  type="date"
                  value={entry.last_verified_at}
                  onChange={(value) =>
                    updateEntry(index, { last_verified_at: value })
                  }
                  required={entry.availability_status !== "unknown"}
                />
                <TextField
                  label="제공사 출처명"
                  value={entry.source_name}
                  onChange={(value) =>
                    updateEntry(index, { source_name: value })
                  }
                  required
                />
                <TextField
                  label="제공사 출처 URL"
                  type="url"
                  value={entry.source_url}
                  onChange={(value) =>
                    updateEntry(index, { source_url: value })
                  }
                />
                <label className="settings-field">
                  <span className="field-label">검수 메모</span>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    value={entry.verification_note}
                    required={
                      entry.availability_status === "not_available" ||
                      entry.availability_status === "temporarily_unavailable"
                    }
                    onChange={(event) =>
                      updateEntry(index, {
                        verification_note: event.target.value
                      })
                    }
                  />
                </label>
                {entries.length > 1 ? (
                  <button
                    className="tertiary-button"
                    type="button"
                    onClick={() =>
                      setEntries((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                  >
                    번호 행 삭제
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className="tertiary-button"
              type="button"
              disabled={entries.length >= 20}
              onClick={() => {
                const key = nextKey.current++;
                setEntries((current) => [
                  ...current,
                  newEntry(key, options.providers[0].id)
                ]);
              }}
            >
              번호 행 추가
            </button>
          </fieldset>

          {submitError === null ? null : (
            <div className="status-box status-box-error" role="alert">
              <p>{submitError}</p>
            </div>
          )}
          {recovery === null ? null : (
            <CreateRecoveryPanel
              state={recovery}
              submitting={submitting}
              onAcknowledge={(value) =>
                setRecovery((current) =>
                  current?.status === "possible"
                    ? { ...current, acknowledged: value }
                    : current
                )
              }
              onRecheck={() => {
                setRecovery({
                  status: "checking",
                  snapshot: recovery.snapshot
                });
                void recoverCreateState(recovery.snapshot);
              }}
              onRetryCreate={() => {
                const snapshot =
                  recovery.status === "possible"
                    ? {
                        ...recovery.snapshot,
                        possible_duplicate_acknowledged_song_ids:
                          recovery.candidates.map((candidate) => candidate.id)
                      }
                    : recovery.snapshot;
                void submitSnapshot(snapshot);
              }}
              onEdit={() => setRecovery(null)}
            />
          )}
          <button
            className="search-button admin-submit"
            type="submit"
            disabled={createDisabled}
          >
            {submitting ? "추가하는 중" : "노래 추가"}
          </button>
        </form>
      </div>
    </main>
  );

  function updateAlias(index: number, patch: Partial<AliasDraft>) {
    setAliases((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
  }

  function updateEntry(index: number, patch: Partial<EntryDraft>) {
    setEntries((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
  }
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
        원제와 가수를 입력하면 중복을 확인합니다.
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
  if (state.status === "invalid") {
    return (
      <div className="status-box status-box-error" role="alert">
        <p>곡 식별 입력을 확인해 주세요.</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="status-box status-box-error" role="alert">
        <p>{state.message}</p>
        {state.retryAfter === undefined ? null : (
          <p>Retry-After: {state.retryAfter}</p>
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
    <CandidateSection
      classification={state.status}
      candidates={state.candidates}
    >
      {state.status === "possible" ? (
        <label className="admin-acknowledgement">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledged(event.target.checked)}
          />
          표시된 후보를 모두 확인했으며 새 곡 추가
        </label>
      ) : null}
    </CandidateSection>
  );
}

function CreateRecoveryPanel({
  state,
  submitting,
  onAcknowledge,
  onRecheck,
  onRetryCreate,
  onEdit
}: Readonly<{
  state: RecoveryState;
  submitting: boolean;
  onAcknowledge: (value: boolean) => void;
  onRecheck: () => void;
  onRetryCreate: () => void;
  onEdit: () => void;
}>) {
  if (state.status === "checking") {
    return (
      <div className="inline-status" role="status">
        저장 결과가 불확실하여 원래 입력으로 상태를 확인하는 중…
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="status-box status-box-error" role="alert">
        <p>
          저장 여부를 확인하지 못했습니다. 자동으로 다시 생성하지 않았습니다.
        </p>
        <button className="tertiary-button" type="button" onClick={onRecheck}>
          상태 다시 확인
        </button>
      </div>
    );
  }
  if (state.status === "exact") {
    return (
      <CandidateSection classification="exact" candidates={state.candidates}>
        <p>
          {state.ambiguous
            ? "곡이 발견되었지만 방금 요청의 성공 여부는 확정할 수 없습니다. 기존 곡을 확인해 주세요."
            : "동일 곡이 이미 존재합니다. 기존 곡을 확인해 주세요."}
        </p>
        <button className="tertiary-button" type="button" onClick={onEdit}>
          입력 수정
        </button>
      </CandidateSection>
    );
  }
  if (state.status === "none") {
    return (
      <div className="status-box status-box-error" role="alert">
        <p>
          현재 동일 곡은 확인되지 않았습니다. 자동 재전송하지 않았으므로
          명시적으로 다시 생성할 수 있습니다.
        </p>
        <button
          className="tertiary-button"
          type="button"
          disabled={submitting}
          onClick={onRetryCreate}
        >
          다시 생성
        </button>
        <button className="tertiary-button" type="button" onClick={onEdit}>
          입력 수정
        </button>
      </div>
    );
  }
  return (
    <CandidateSection classification="possible" candidates={state.candidates}>
      <p>최신 후보 전체를 다시 확인한 뒤에만 재제출할 수 있습니다.</p>
      <label className="admin-acknowledgement">
        <input
          type="checkbox"
          checked={state.acknowledged}
          onChange={(event) => onAcknowledge(event.target.checked)}
        />
        표시된 후보를 모두 확인했으며 새 곡 추가
      </label>
      <button
        className="tertiary-button"
        type="button"
        disabled={!state.acknowledged || submitting}
        onClick={onRetryCreate}
      >
        다시 생성
      </button>
      <button className="tertiary-button" type="button" onClick={onEdit}>
        입력 수정
      </button>
    </CandidateSection>
  );
}

function CandidateSection({
  classification,
  candidates,
  children
}: Readonly<{
  classification: "exact" | "possible";
  candidates: readonly CandidateSummary[];
  children?: React.ReactNode;
}>) {
  return (
    <section
      className={`status-box${classification === "exact" ? " status-box-error" : ""}`}
      aria-labelledby={`create-duplicate-${classification}`}
    >
      <h2 id={`create-duplicate-${classification}`}>
        {classification === "exact"
          ? "동일 곡이 이미 있습니다"
          : "중복 가능 후보"}
      </h2>
      <ul className="admin-candidate-list">
        {candidates.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} />
        ))}
      </ul>
      {children}
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
      {candidate.provider_summary.length === 0 ? null : (
        <ul aria-label="제공사 번호">
          {candidate.provider_summary.map((entry, index) => (
            <li key={`${entry.provider_id}-${index}`}>
              {entry.provider_name} {entry.karaoke_number}
              {entry.version_info === "" ? "" : ` · ${entry.version_info}`}
            </li>
          ))}
        </ul>
      )}
      <ul aria-label="일치 근거">
        {candidate.match_evidence.map((evidence, index) => (
          <li key={`${evidence.role}-${index}`}>
            {evidence.role} {evidence.strength} · {evidence.input_field} →{" "}
            {evidence.candidate_field} · {evidence.matched_value}
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

function CatalogNotEnabledPage() {
  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <section className="settings-hero">
          <p className="eyebrow">Admin</p>
          <h1>관리자 카탈로그가 아직 활성화되지 않았습니다</h1>
          <p className="settings-description">
            현재 관리자 카탈로그에 접근할 수 없습니다.
          </p>
        </section>
        <CatalogNavigationLinks />
      </div>
    </main>
  );
}

function CatalogNotEnabledNotice() {
  return (
    <section
      className="status-box status-box-error"
      aria-labelledby="admin-catalog-disabled-title"
      role="alert"
    >
      <h2 id="admin-catalog-disabled-title">
        관리자 카탈로그가 아직 활성화되지 않았습니다
      </h2>
      <p>입력과 제출 snapshot은 유지되지만 현재 생성할 수 없습니다.</p>
      <CatalogNavigationLinks />
    </section>
  );
}

function CatalogNavigationLinks() {
  return (
    <nav className="admin-forbidden-links" aria-label="이동 링크">
      <Link className="secondary-button" href="/">
        홈으로
      </Link>
      <Link className="tertiary-button" href="/">
        공개 검색으로
      </Link>
    </nav>
  );
}

function TextField({
  label,
  name,
  type = "text",
  required,
  defaultValue,
  min,
  max,
  value,
  disabled,
  error,
  onChange
}: Readonly<{
  label: string;
  name?: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  min?: string;
  max?: string;
  value?: string;
  disabled?: boolean;
  error?: string;
  onChange?: (value: string) => void;
}>) {
  return (
    <label className="settings-field">
      <span className="field-label">{label}</span>
      <input
        className="search-input"
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error === undefined ? undefined : true}
        onChange={
          onChange === undefined
            ? undefined
            : (event) => onChange(event.target.value)
        }
      />
      {error === undefined ? null : (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function AdminState({
  title,
  copy,
  error = false
}: Readonly<{ title: string; copy?: string; error?: boolean }>) {
  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <section className="settings-hero">
          <p className="eyebrow">Admin</p>
          <h1>노래 추가</h1>
        </section>
        <div
          className={`status-box${error ? " status-box-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <p>{title}</p>
          {copy === undefined ? null : <p>{copy}</p>}
        </div>
      </div>
    </main>
  );
}

function newEntry(key: number, providerId: string): EntryDraft {
  return {
    key,
    provider_id: providerId,
    karaoke_number: "",
    version_info: "",
    availability_status: "available",
    last_verified_at: "",
    source_name: "",
    source_url: "",
    verification_note: ""
  };
}

function buildSnapshot(
  data: FormData,
  identity: IdentityDraft,
  aliases: readonly AliasDraft[],
  entries: readonly EntryDraft[],
  acknowledgedIds: readonly string[] | undefined
): AdminSongInput {
  return {
    original_language: field(data, "original_language"),
    canonical_title: identity.canonicalTitle,
    display_title: identity.displayTitle,
    canonical_artist: identity.canonicalArtist,
    release_year: optionalNumber(data, "release_year"),
    tie_in: optionalField(data, "tie_in"),
    source_url: optionalField(data, "source_url"),
    source_name: field(data, "source_name"),
    aliases: aliases.map(
      ({ alias, language, alias_type, source_name, source_url }) => ({
        alias,
        language,
        alias_type,
        source_name: nullable(source_name),
        source_url: nullable(source_url)
      })
    ),
    karaoke_entries: entries.map(
      ({
        provider_id,
        karaoke_number,
        version_info,
        availability_status,
        last_verified_at,
        source_name,
        source_url,
        verification_note
      }) => ({
        provider_id,
        karaoke_number,
        version_info,
        availability_status,
        last_verified_at: nullable(last_verified_at),
        source_name,
        source_url: nullable(source_url),
        verification_note: nullable(verification_note)
      })
    ),
    ...(acknowledgedIds === undefined
      ? {}
      : { possible_duplicate_acknowledged_song_ids: [...acknowledgedIds] })
  };
}

function recoveryFromDuplicateResult(
  snapshot: AdminSongInput,
  result: DuplicateCheckResult
): RecoveryState {
  if (result.classification === "none") {
    return { status: "none", snapshot, candidates: [] };
  }
  if (result.classification === "exact") {
    return {
      status: "exact",
      snapshot,
      candidates: result.candidates,
      ambiguous: true
    };
  }
  return {
    status: "possible",
    snapshot,
    candidates: result.candidates,
    acknowledged: false
  };
}

function candidatesFromError(
  error: AdminSongClientError
): readonly CandidateSummary[] {
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
  return payload.error.details.candidates.filter(isCandidateSummary);
}

function isCandidateSummary(value: unknown): value is CandidateSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "display_title" in value &&
    typeof value.display_title === "string" &&
    "canonical_title" in value &&
    typeof value.canonical_title === "string" &&
    "canonical_artist" in value &&
    typeof value.canonical_artist === "string" &&
    "original_language" in value &&
    typeof value.original_language === "string" &&
    "provider_summary" in value &&
    Array.isArray(value.provider_summary) &&
    "match_evidence" in value &&
    Array.isArray(value.match_evidence)
  );
}

function field(data: FormData, name: string): string {
  return String(data.get(name) ?? "");
}

function optionalField(data: FormData, name: string): string | null {
  return nullable(field(data, name));
}

function optionalNumber(data: FormData, name: string): number | null {
  const value = field(data, name).trim();
  return value === "" ? null : Number(value);
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isAmbiguousCreateError(error: unknown): boolean {
  return (
    !(error instanceof AdminSongClientError) ||
    (error.status !== undefined && error.status >= 500)
  );
}

function messageForError(error: unknown): string {
  if (error instanceof AdminSongClientError) {
    if (error.code === "PROVIDER_NOT_FOUND") {
      return "선택한 제공사를 사용할 수 없습니다. 새로고침 후 다시 시도해 주세요.";
    }
    if (error.code === "VALIDATION_ERROR") {
      return "입력값을 확인해 주세요. 각 제공사 상태의 번호, 확인일, 출처와 검수 메모가 필요합니다.";
    }
    if (error.code === "PAYLOAD_TOO_LARGE") {
      return "입력 내용이 512KiB 제한을 초과했습니다.";
    }
    if (error.code === "FORBIDDEN") return "관리자 권한이 없습니다.";
  }
  return "노래 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function isAdminCatalogNotEnabled(error: unknown): boolean {
  return (
    error instanceof AdminSongClientError &&
    error.code === "ADMIN_CATALOG_NOT_ENABLED"
  );
}
