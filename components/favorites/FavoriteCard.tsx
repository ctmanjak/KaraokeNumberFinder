"use client";

import type { FavoriteListItem } from "@/lib/favorites/client";

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "사용 가능",
  not_available: "미수록",
  temporarily_unavailable: "일시 이용 불가",
  unknown: "확인 필요"
};

export function FavoriteCard({
  item,
  isDeleting,
  onDelete
}: Readonly<{
  item: FavoriteListItem;
  isDeleting: boolean;
  onDelete: () => void;
}>) {
  return (
    <li className="result-card favorite-card">
      <div className="result-heading">
        <div className="result-title-group">
          <h2>{item.song.display_title}</h2>
          {item.song.canonical_title === item.song.display_title ? null : (
            <p className="canonical-title">{item.song.canonical_title}</p>
          )}
        </div>
        <button
          className="favorite-button"
          type="button"
          aria-label={`${item.song.display_title} 즐겨찾기에서 제거`}
          aria-pressed="true"
          disabled={isDeleting}
          onClick={onDelete}
        >
          <span aria-hidden="true">★</span>
        </button>
      </div>

      <p className="artist-name">{item.song.canonical_artist}</p>
      {item.song.distinguishing_labels.length === 0 ? null : (
        <div className="label-row" aria-label="구분 라벨">
          {item.song.distinguishing_labels.map((label) => (
            <span className="pill" key={label}>
              {label}
            </span>
          ))}
        </div>
      )}

      <div className="favorite-provider-list" aria-label="제공사별 번호">
        {item.song.karaoke_entries.length === 0 ? (
          <p className="form-note">등록된 노래방 번호가 없습니다.</p>
        ) : (
          item.song.karaoke_entries.map((entry) => (
            <div className="favorite-provider-row" key={entry.id}>
              <span className="provider-row-name">{entry.provider.name}</span>
              <strong className="favorite-provider-number">
                {entry.availability_status === "available" &&
                entry.karaoke_number.trim().length > 0
                  ? entry.karaoke_number
                  : (AVAILABILITY_LABELS[entry.availability_status] ??
                    "확인 필요")}
              </strong>
              <div className="provider-row-meta">
                {entry.version_info.trim().length === 0 ? null : (
                  <span>{entry.version_info}</span>
                )}
                {entry.last_verified_at === null ? (
                  <span>확인일 정보 없음</span>
                ) : (
                  <span>확인일 {entry.last_verified_at}</span>
                )}
                {entry.is_stale ? <span>오래된 정보</span> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </li>
  );
}
