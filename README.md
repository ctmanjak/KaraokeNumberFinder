# KaraokeNumberFinder

![MVP](https://img.shields.io/badge/MVP-in_progress-111827?style=for-the-badge)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-20232a?style=for-the-badge&logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-1f2937?style=for-the-badge&logo=typescript)
![Audit](https://img.shields.io/badge/audit-clean-064e3b?style=for-the-badge)

노래방에서 외국어 곡 번호를 빠르게 찾기 위한 검색 중심 웹앱입니다.

한국어 제목, 원제, 로마자, 영문명, 콘텐츠명, 약칭, 한글 초성처럼 사용자가 실제로 기억하는 표현을 받아 제공사별 예약 번호와 수록 상태를 보여주는 것이 목표입니다.

## 현재 상태

```text
단계      초기 MVP
초점      모바일 검색 루프
데이터    검수 CSV seed -> PostgreSQL
인증      이후 milestone에서 구현
```

## 해결하려는 문제

외국어 곡 검색은 표기가 흩어집니다. 같은 곡도 원제, 번역명, 로마자 표기, 애니메이션 제목, 약칭으로 따로 기억됩니다.

KaraokeNumberFinder는 원문 데이터는 보존하고 검색용 별칭과 정규화 값을 따로 관리합니다. 사용자는 알고 있는 표현으로 곡을 찾고, 모바일 화면에서 기본 제공사 번호와 다른 제공사 상태를 바로 확인할 수 있습니다.

## 기술 스택

| 영역      | 선택                   |
| --------- | ---------------------- |
| 앱        | Next.js 16 App Router  |
| UI 런타임 | React 19               |
| 언어      | TypeScript             |
| 품질 관리 | ESLint, Prettier       |
| 테스트    | Vitest                 |
| 데이터    | PostgreSQL with Prisma |
| Seed      | CSV 기반 workflow      |

Next.js 16은 기본 빌드에서 Turbopack을 사용합니다. `postcss`는 의존성 audit을 깨끗하게 유지하기 위해 `package.json`의 `overrides`에서 안전한 버전으로 고정합니다.

## 빠른 시작

```bash
npm install
cp .env.example .env
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

로컬 환경변수는 `.env.example`을 기준으로 설정합니다. PostgreSQL 연결 문자열은 `DATABASE_URL`에 둡니다. Prisma 7에서는 이 값을 `prisma/schema.prisma`가 아니라 루트 `prisma.config.ts`에서 읽습니다.

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/karaoke_number_finder?schema=public"
```

로컬 PostgreSQL은 Homebrew, Postgres.app, Docker 등 팀원이 편한 방식으로 실행할 수 있습니다. Homebrew 예시는 다음과 같습니다.

```bash
brew install postgresql@16
brew services start postgresql@16
createdb karaoke_number_finder
```

Docker Compose는 아직 도입하지 않았습니다. T02 범위에서는 Prisma 7 CLI가 `prisma.config.ts`를 통해 `DATABASE_URL`로 로컬 PostgreSQL에 연결할 수 있으면 충분하며, 공유 DB 실행 방식이 필요해지면 후속 티켓에서 Compose를 추가합니다.

Prisma Client는 `prisma-client` generator로 `lib/generated/prisma`에 생성됩니다. 생성물은 저장소에 커밋하지 않고 필요할 때 `npm run db:generate`로 다시 만듭니다.

## 검증 명령

```bash
npm run format
npm run typecheck
npm run lint
npm run test
npm run db:validate
npx prisma migrate dev --name add_core_search_schema
npm run db:generate
npm run build
npm audit --audit-level=moderate
```

| 명령어                 | 설명               |
| ---------------------- | ------------------ |
| `npm run dev`          | 개발 서버 실행     |
| `npm run build`        | 프로덕션 빌드 생성 |
| `npm run start`        | 빌드된 앱 실행     |
| `npm run typecheck`    | TypeScript 검사    |
| `npm run lint`         | ESLint 실행        |
| `npm run format`       | 포맷 검사          |
| `npm run format:write` | 포맷 적용          |
| `npm run test`         | 테스트 실행        |
| `npm run db:validate`  | Prisma schema 검사 |
| `npm run db:generate`  | Prisma Client 생성 |
| `npm run db:studio`    | Prisma Studio 실행 |

Prisma migration은 Prisma 7 설정 파일을 통해 `.env`의 `DATABASE_URL`을 읽습니다.

```bash
npx prisma migrate dev --name add_core_search_schema
```

Prisma Client는 `lib/generated/prisma`에 생성되며 저장소에 커밋하지 않습니다.

## Public API

### `GET /api/search`

인증 없이 DB의 `Song`, `SongAlias`, `KaraokeProvider`, `KaraokeEntry` 데이터를 기준으로 검색 결과 카드에 필요한 정보를 반환합니다.

```bash
curl "http://localhost:3000/api/search?q=fixture"
curl "http://localhost:3000/api/search?q=%E3%84%B1%E3%84%B4&provider_id=provider_alpha&limit=10"
```

Query parameters:

| 이름          | 기본값 | 설명                                                  |
| ------------- | ------ | ----------------------------------------------------- |
| `q`           | 필수   | 공백 제거 후 1자 이상 검색어                          |
| `provider_id` | 없음   | 활성 제공사 ID. 지정하면 해당 제공사 수록 여부를 우선 |
| `limit`       | `20`   | 반환 개수. 1 이상 50 이하 정수                        |

검색은 `SongAlias.normalized_alias`의 exact/prefix/partial match와 `chosung_alias` prefix match를 사용합니다. 한글 초성 검색은 2자 이상 query에서만 적용합니다.

```json
{
  "query": "Fixture Alias",
  "normalized_query": "fixturealias",
  "items": [
    {
      "song": {
        "id": "song_fixture_001",
        "original_language": "ja",
        "canonical_title": "Fixture Original Title",
        "display_title": "Fixture Display Title",
        "canonical_artist": "Fixture Artist",
        "release_year": 2026,
        "tie_in": "Fixture Series OP",
        "matched_aliases": [
          {
            "id": "alias_fixture_001_ko",
            "alias": "Fixture Alias",
            "language": "ko",
            "alias_type": "translated_title"
          }
        ]
      },
      "karaoke_entries": [
        {
          "id": "entry_fixture_001_alpha",
          "provider_id": "provider_alpha",
          "karaoke_number": "12345",
          "version_info": "original",
          "availability_status": "available",
          "last_verified_at": "2026-06-25",
          "is_stale": false
        }
      ],
      "distinguishing_labels": ["Fixture Artist", "Fixture Series OP", "2026"],
      "relevance_score": 100
    }
  ],
  "next_cursor": null,
  "suggestions": []
}
```

오류 응답은 다음 형태를 사용합니다.

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "q must contain at least one non-whitespace character."
  }
}
```

### `GET /api/providers`

인증 없이 DB의 `KaraokeProvider` 데이터를 기준으로 제공사 목록을 반환합니다. 기본값은 활성 제공사만 조회합니다.

```bash
curl "http://localhost:3000/api/providers"
curl "http://localhost:3000/api/providers?country=KR"
curl "http://localhost:3000/api/providers?active_only=false"
```

Query parameters:

| 이름          | 기본값 | 설명                                            |
| ------------- | ------ | ----------------------------------------------- |
| `country`     | 없음   | ISO 3166-1 alpha-2 대문자 2글자 국가 코드 필터  |
| `active_only` | `true` | `true`면 활성 제공사만, `false`면 비활성도 포함 |

응답은 `display_order`, `name`, `id` 순으로 안정 정렬됩니다.
`last_catalog_updated_at`은 값이 있으면 `YYYY-MM-DD` 날짜 문자열로 반환합니다.

```json
{
  "items": [
    {
      "id": "provider_alpha",
      "name": "Generic Provider Alpha",
      "country": "KR",
      "is_active": true,
      "display_order": 10,
      "is_default": true,
      "last_catalog_updated_at": null
    }
  ]
}
```

오류 응답은 다음 형태를 사용합니다.

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "active_only must be either true or false."
  }
}
```

## 프로젝트 구조

```text
app/
  layout.tsx
  page.tsx
components/
lib/
  db/
  search/
  seed/
prisma/
seed/
scripts/
  seed/
```

## 로드맵

| 영역     | 다음 작업                                        |
| -------- | ------------------------------------------------ |
| 데이터   | Prisma 설정, schema, migration                   |
| Seed     | CSV 헤더, validation, add/import CLI, smoke test |
| 검색 API | 제공사 목록 endpoint와 검색 endpoint             |
| UI       | 모바일 검색 화면, 결과 카드, 빈 상태/오류 상태   |

## 원칙

- 제공사 데이터는 UI 조건문이 아니라 데이터베이스에 둡니다.
- 원문 제목은 보존하고, 검색은 정규화 별칭으로 처리합니다.
- 계정 기능보다 검색과 번호 확인 루프를 먼저 완성합니다.
- 기본 경험은 모바일 폭의 집중된 1열 화면입니다.
