"use client";

import type { ProviderListItem } from "@/lib/providers/providers";
import type { SearchKaraokeEntry, SearchResultItem } from "@/lib/search/search";

type SearchResultCardProps = {
  item: SearchResultItem;
  providers: ProviderListItem[];
  selectedProviderId?: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
};

type ProviderDisplay = {
  id: string;
  name: string;
  entries: SearchKaraokeEntry[];
};

const AVAILABILITY_LABELS: Record<string, string> = {
  not_available: "미수록",
  temporarily_unavailable: "일시 이용 불가",
  unknown: "확인 필요"
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "영어",
  ja: "일본어",
  ko: "한국어",
  zh: "중국어"
};

export function SearchResultCard({
  item,
  providers,
  selectedProviderId,
  isExpanded,
  onToggleExpanded
}: SearchResultCardProps) {
  const providerNameById = providerNameMap(providers);
  const primaryEntry = selectPrimaryEntry(item.karaoke_entries, {
    selectedProviderId
  });
  const primaryProviderId = selectedProviderId ?? primaryEntry?.provider_id;
  const primaryProviderName =
    primaryProviderId === undefined
      ? "제공사 미선택"
      : providerName(providerNameById, primaryProviderId);
  const hasPrimaryAvailable = isAvailableWithNumber(primaryEntry);
  const hasAvailableFromAnotherProvider =
    primaryProviderId !== undefined &&
    !hasPrimaryAvailable &&
    item.karaoke_entries.some(
      (entry) =>
        entry.provider_id !== primaryProviderId && isAvailableWithNumber(entry)
    );
  const matchedAlias = item.song.matched_aliases[0]?.alias;
  const providerRows = providerDisplays(item.karaoke_entries, providers);

  return (
    <li className="result-card">
      <div className="result-heading">
        <div className="result-title-group">
          <h2>{item.song.display_title}</h2>
          <p className="canonical-title">{item.song.canonical_title}</p>
        </div>
        <span className="score-label">관련도 {item.relevance_score}</span>
      </div>

      <p className="artist-name">{item.song.canonical_artist}</p>
      <p className="language-label">
        언어: {languageLabel(item.song.original_language)}
      </p>

      {item.distinguishing_labels.length > 0 ? (
        <div className="label-row" aria-label="구분 라벨">
          {item.distinguishing_labels.map((label) => (
            <span className="pill" key={label}>
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {matchedAlias === undefined ? null : (
        <p className="matched-alias">일치한 별칭: {matchedAlias}</p>
      )}

      <div className="primary-number-panel" aria-label="선택 제공사 번호">
        <span className="provider-name">{primaryProviderName}</span>
        {hasPrimaryAvailable ? (
          <strong className="karaoke-number">
            {primaryEntry?.karaoke_number}
          </strong>
        ) : (
          <strong className="status-number">
            {availabilityLabel(primaryEntry)}
          </strong>
        )}
        {primaryEntry?.version_info ? (
          <span className="version-label">{primaryEntry.version_info}</span>
        ) : null}
        <div className="meta-row">
          <span>{verificationLabel(primaryEntry)}</span>
          {primaryEntry?.is_stale ? (
            <span className="stale-label">오래된 정보</span>
          ) : null}
        </div>
        {hasAvailableFromAnotherProvider ? (
          <span className="other-provider-badge">다른 제공사 번호 있음</span>
        ) : null}
      </div>

      <button
        className="expand-button"
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggleExpanded}
      >
        {isExpanded ? "접기" : "제공사별 비교"}
      </button>

      {isExpanded ? (
        <div className="provider-comparison" aria-label="제공사별 번호 비교">
          {providerRows.map((row) => (
            <div className="provider-row" key={row.id}>
              <span className="provider-row-name">{row.name}</span>
              <div className="provider-entry-list">
                {(row.entries.length > 0 ? row.entries : [null]).map(
                  (entry) => (
                    <div
                      className="provider-entry"
                      key={entry?.id ?? `${row.id}-missing-entry`}
                    >
                      <strong className="provider-row-value">
                        {isAvailableWithNumber(entry)
                          ? entry?.karaoke_number
                          : availabilityLabel(entry)}
                      </strong>
                      <div className="provider-row-meta">
                        {entry?.version_info ? (
                          <span>{entry.version_info}</span>
                        ) : null}
                        <span>{availabilityLabel(entry)}</span>
                        <span>{verificationLabel(entry)}</span>
                        {entry?.is_stale ? <span>오래된 정보</span> : null}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function selectPrimaryEntry(
  entries: SearchKaraokeEntry[],
  options: { selectedProviderId?: string }
): SearchKaraokeEntry | null {
  if (options.selectedProviderId !== undefined) {
    const selectedEntries = entries.filter(
      (entry) => entry.provider_id === options.selectedProviderId
    );

    return (
      selectedEntries.find((entry) => isAvailableWithNumber(entry)) ??
      selectedEntries[0] ??
      null
    );
  }

  return (
    entries.find((entry) => isAvailableWithNumber(entry)) ?? entries[0] ?? null
  );
}

function providerDisplays(
  entries: SearchKaraokeEntry[],
  providers: ProviderListItem[]
): ProviderDisplay[] {
  const displays = providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    entries: entries.filter((entry) => entry.provider_id === provider.id)
  }));
  const knownProviderIds = new Set(providers.map((provider) => provider.id));
  const extraEntriesByProviderId = new Map<string, SearchKaraokeEntry[]>();

  for (const entry of entries) {
    if (knownProviderIds.has(entry.provider_id)) {
      continue;
    }

    const providerEntries = extraEntriesByProviderId.get(entry.provider_id);

    if (providerEntries === undefined) {
      extraEntriesByProviderId.set(entry.provider_id, [entry]);
    } else {
      providerEntries.push(entry);
    }
  }
  const extraDisplays = Array.from(extraEntriesByProviderId.entries()).map(
    ([providerId, providerEntries]) => ({
      id: providerId,
      name: providerId,
      entries: providerEntries
    })
  );

  return [...displays, ...extraDisplays];
}

function providerNameMap(providers: ProviderListItem[]): Map<string, string> {
  return new Map(providers.map((provider) => [provider.id, provider.name]));
}

function providerName(names: Map<string, string>, providerId: string): string {
  return names.get(providerId) ?? providerId;
}

function availabilityLabel(entry: SearchKaraokeEntry | null): string {
  if (entry === null) {
    return "확인 필요";
  }

  if (isAvailableWithNumber(entry)) {
    return "사용 가능";
  }

  if (entry.availability_status === "available") {
    return "확인 필요";
  }

  return AVAILABILITY_LABELS[entry.availability_status] ?? "확인 필요";
}

function verificationLabel(entry: SearchKaraokeEntry | null): string {
  if (entry === null || entry.last_verified_at === null) {
    return "확인일 정보 없음";
  }

  return `확인일 ${entry.last_verified_at}`;
}

function isAvailableWithNumber(entry: SearchKaraokeEntry | null): boolean {
  return (
    entry !== null &&
    entry.availability_status === "available" &&
    entry.karaoke_number.trim() !== ""
  );
}

function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language;
}
