"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  AdminSongClientError,
  createAdminSong,
  fetchAdminSongOptions
} from "@/lib/admin-song/client";
import type {
  AdminAliasType,
  AdminAvailabilityStatus,
  AdminSongOptions
} from "@/lib/admin-song/types";

type AliasDraft = {
  key: number;
  alias: string;
  language: string;
  alias_type: AdminAliasType;
};

type EntryDraft = {
  key: number;
  provider_id: string;
  karaoke_number: string;
  version_info: string;
  availability_status: AdminAvailabilityStatus;
  last_verified_at: string;
};

export function AdminSongPage() {
  const auth = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const nextKey = useRef(2);
  const [options, setOptions] = useState<AdminSongOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);
  const [catalogNotEnabled, setCatalogNotEnabled] = useState<
    "load" | "submit" | null
  >(null);
  const [aliases, setAliases] = useState<AliasDraft[]>([]);
  const [entries, setEntries] = useState<EntryDraft[]>([]);

  useEffect(() => {
    if (auth.state.status !== "authenticated" || !auth.state.user.is_admin) {
      return;
    }
    const controller = new AbortController();
    queueMicrotask(async () => {
      try {
        const loaded = await fetchAdminSongOptions(fetch, controller.signal);
        setOptions(loaded);
        setEntries((current) =>
          current.length > 0 || loaded.providers.length === 0
            ? current
            : [newEntry(1, loaded.providers[0].id)]
        );
        setCatalogNotEnabled(null);
        setLoadError(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          if (isAdminCatalogNotEnabled(error)) {
            setCatalogNotEnabled("load");
            setLoadError(null);
          } else {
            setLoadError(messageForError(error));
          }
        }
      }
    });
    return () => controller.abort();
  }, [auth.state]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || options === null || catalogNotEnabled !== null) return;
    setSubmitting(true);
    setSubmitError(null);
    setCreatedMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await createAdminSong({
        original_language: field(data, "original_language"),
        canonical_title: field(data, "canonical_title"),
        display_title: field(data, "display_title"),
        canonical_artist: field(data, "canonical_artist"),
        release_year: optionalNumber(data, "release_year"),
        tie_in: optionalField(data, "tie_in"),
        source_url: optionalField(data, "source_url"),
        source_name: field(data, "source_name"),
        verification_note: optionalField(data, "verification_note"),
        aliases: aliases.map(({ alias, language, alias_type }) => ({
          alias,
          language,
          alias_type
        })),
        karaoke_entries: entries.map(
          ({
            provider_id,
            karaoke_number,
            version_info,
            availability_status,
            last_verified_at
          }) => ({
            provider_id,
            karaoke_number,
            version_info,
            availability_status,
            last_verified_at: last_verified_at || null
          })
        )
      });
      setCreatedMessage(
        `${result.song.display_title} · ${result.song.canonical_artist}을(를) 추가했습니다.`
      );
      formRef.current?.reset();
      setAliases([]);
      setEntries([newEntry(nextKey.current++, options.providers[0].id)]);
    } catch (error) {
      if (isAdminCatalogNotEnabled(error)) {
        setCatalogNotEnabled("submit");
        setSubmitError(null);
      } else {
        setSubmitError(messageForError(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="search-shell">
      <div className="mobile-frame admin-frame">
        <section className="settings-hero" aria-labelledby="admin-song-title">
          <p className="eyebrow">Admin</p>
          <h1 id="admin-song-title">노래 추가</h1>
          <p className="settings-description">
            곡 정보와 검색 별칭, 제공사별 번호를 한 번에 등록합니다.
          </p>
        </section>

        {catalogNotEnabled === "submit" ? <CatalogNotEnabledNotice /> : null}

        <form ref={formRef} className="admin-song-form" onSubmit={handleSubmit}>
          <fieldset
            className="settings-section"
            disabled={catalogNotEnabled === "submit"}
          >
            <legend>곡 기본 정보</legend>
            <TextField
              name="original_language"
              label="원어 코드"
              defaultValue="ja"
              required
            />
            <TextField name="canonical_title" label="원제" required />
            <TextField name="display_title" label="표시 제목" required />
            <TextField name="canonical_artist" label="가수" required />
            <TextField
              name="release_year"
              label="발매 연도"
              type="number"
              min="1000"
              max="9999"
            />
            <TextField name="tie_in" label="작품/타이인" />
          </fieldset>

          <fieldset
            className="settings-section"
            disabled={catalogNotEnabled === "submit"}
          >
            <legend>출처와 검수</legend>
            <TextField name="source_name" label="출처명" required />
            <TextField name="source_url" label="출처 URL" type="url" />
            <label className="settings-field">
              <span className="field-label">검수 메모</span>
              <textarea
                className="admin-textarea"
                name="verification_note"
                rows={3}
              />
            </label>
          </fieldset>

          <fieldset
            className="settings-section"
            disabled={catalogNotEnabled === "submit"}
          >
            <legend>추가 검색 별칭</legend>
            <p className="form-note">
              원제, 표시 제목, 가수 별칭은 자동 생성됩니다.
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
                        alias_type: event.target.value as AdminAliasType
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
              onClick={() =>
                setAliases((current) => [
                  ...current,
                  {
                    key: nextKey.current++,
                    alias: "",
                    language: "ko",
                    alias_type: "translated_title"
                  }
                ])
              }
            >
              별칭 추가
            </button>
          </fieldset>

          <fieldset
            className="settings-section"
            disabled={catalogNotEnabled === "submit"}
          >
            <legend>노래방 번호</legend>
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
                />
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
              onClick={() =>
                setEntries((current) => [
                  ...current,
                  newEntry(nextKey.current++, options.providers[0].id)
                ])
              }
            >
              번호 행 추가
            </button>
          </fieldset>

          {submitError === null ? null : (
            <div className="status-box status-box-error" role="alert">
              <p>{submitError}</p>
            </div>
          )}
          {createdMessage === null ? null : (
            <div className="inline-status" role="status">
              {createdMessage}
            </div>
          )}
          <button
            className="search-button admin-submit"
            type="submit"
            disabled={submitting || catalogNotEnabled === "submit"}
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
      <p>입력한 내용은 유지되지만 현재 저장할 수 없습니다.</p>
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
        onChange={
          onChange === undefined
            ? undefined
            : (event) => onChange(event.target.value)
        }
      />
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
    last_verified_at: ""
  };
}

function field(data: FormData, name: string): string {
  return String(data.get(name) ?? "");
}
function optionalField(data: FormData, name: string): string | null {
  const value = field(data, name).trim();
  return value === "" ? null : value;
}
function optionalNumber(data: FormData, name: string): number | null {
  const value = field(data, name).trim();
  return value === "" ? null : Number(value);
}

function messageForError(error: unknown): string {
  if (error instanceof AdminSongClientError) {
    if (error.code === "DUPLICATE_SONG")
      return "같은 원제와 가수의 곡이 이미 있습니다.";
    if (error.code === "PROVIDER_NOT_FOUND")
      return "선택한 제공사를 사용할 수 없습니다. 새로고침 후 다시 시도해 주세요.";
    if (error.code === "VALIDATION_ERROR")
      return "입력값을 확인해 주세요. 수록 곡은 예약 번호가 필요합니다.";
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
