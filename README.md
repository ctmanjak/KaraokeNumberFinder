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
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

로컬 환경변수는 `.env.example`을 기준으로 설정합니다. Prisma schema와 실제 DB 연결은 다음 milestone 작업에서 구성합니다.

## 검증 명령

```bash
npm run format
npm run typecheck
npm run lint
npm run test
npm run build
npm audit
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
