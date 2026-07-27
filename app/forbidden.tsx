import Link from "next/link";

export default function Forbidden() {
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
        <nav className="admin-forbidden-links" aria-label="이동 링크">
          <Link className="secondary-button" href="/">
            홈으로
          </Link>
          <Link className="tertiary-button" href="/">
            공개 검색으로
          </Link>
        </nav>
      </div>
    </main>
  );
}
