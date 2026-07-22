# M3-T13 실제 브라우저 인증·개인화 E2E

## 범위와 실행 계약

Playwright의 실제 Chromium에서 공개 검색, Google OAuth 경계, 세션 cookie, 로그아웃, 즐겨찾기·최근 검색·기본 제공사 격리, 실패 복구와 늦은 응답을 검증한다. 실제 Google endpoint와 계정은 호출하지 않는다. OAuth 시작 URL까지는 프로덕션 경로를 사용하고, `accounts.google.com` 탐색 경계만 Playwright route로 가로채 성공·취소·공급자 실패를 재현한다.

로컬과 CI의 단일 실행 명령은 다음과 같다.

```bash
M3_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/karaoke_number_finder_m3_test \
  npm run test:e2e

# 동일 suite를 2회 반복해 flake를 확인한다.
M3_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/karaoke_number_finder_m3_test \
  npm run test:e2e:repeat
```

runner는 migration 배포, 검수 seed import, 잔여 E2E 데이터 정리, 임시 제공사와 검색 catalog 생성, 프로덕션 build, HTTPS 앱 서버, Chromium, 종료 정리를 순서대로 관리한다. `M3_TEST_DATABASE_URL`은 PostgreSQL, loopback host, 정확한 `karaoke_number_finder_m3_test` DB 이름이 아니면 실행 전 실패한다. 브라우저 worker는 2개로 고정하며 테스트마다 UUID 사용자와 독립 browser context를 사용한다. 임시 사용자는 `@e2e.invalid`, 임시 catalog는 `knf-browser-e2e` 표식으로만 정리한다. provider ID·이름·개수, song ID와 결과 순서는 DB에서 읽고 테스트에 하드코딩하지 않는다. 각 browser context에는 서로 다른 예약 테스트 IP를 전달해 production Better Auth rate limit을 끄지 않고도 독립 사용자를 재현한다.

## 테스트용 인증 경계와 fail-closed 조건

`/api/e2e/control`은 아래 조건이 모두 참일 때만 응답한다. 하나라도 다르면 존재를 숨기는 `404`를 반환한다.

- `NODE_ENV=production`: 실제 build/server의 cookie 동작을 사용한다.
- `KNF_RUNTIME_ENV=e2e`와 `KNF_E2E_AUTH_ENABLED=1`: 일반 production runtime과 명시적으로 분리한다.
- `DATABASE_URL === M3_TEST_DATABASE_URL`: 앱 DB와 승인된 E2E DB가 정확히 같다.
- DB가 loopback PostgreSQL의 정확한 `karaoke_number_finder_m3_test`이다.
- `BETTER_AUTH_URL`이 loopback HTTPS origin이다.
- 요청 `Origin`과 직접 또는 local reverse proxy의 공개 origin이 `BETTER_AUTH_URL`과 정확히 같고, `x-knf-e2e-test: 1`이 있다. `Sec-Fetch-Site`가 있으면 `same-origin`이어야 한다.

production origin, 원격 DB, 개발 server, 누락된 opt-in, 불일치 DB/origin, cross-site 요청은 `lib/e2e/guard.test.ts`에서 차단을 검증한다. runner가 매 실행마다 생성하는 Better Auth와 mock Google secret은 파일·fixture·로그에 기록하지 않는다. 제어 API의 응답도 세션 token을 반환하지 않는다.

## Traceability

| T13 완료 조건                                                     | 브라우저 증거                                                                                                      | 기존 계층의 보완 증거 / 중복하지 않은 이유                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 공개 검색, mock 로그인 성공, reload·동일 origin 탐색 후 세션 유지 | `e2e/auth-security.spec.ts` — `public search transitions through mock Google login and survives reload/navigation` | OAuth 암호 검증 자체는 `lib/auth/auth-integration.test.ts`에 유지한다.                                                                                             |
| 로그인 취소·공급자 실패 후 안전 복귀와 검색 지속                  | `e2e/auth-security.spec.ts` — `mock Google access_denied...`, `mock Google server_error...`                        | PKCE/state/JWKS/replay 세부 assertion은 route/API 통합 테스트의 책임이다.                                                                                          |
| cookie 속성, 공개 session JSON, 로그아웃, 폐기 cookie 재사용 401  | `e2e/auth-security.spec.ts` — `secure host cookie...`                                                              | cookie 문자열 생성 규칙은 `lib/auth/options.test.ts`와 `lib/auth/session-policy.test.ts`, 보호 route 오류 envelope는 personalization route 테스트가 상세 검증한다. |
| 외부 redirect 차단과 로그인 session 회전                          | `e2e/auth-security.spec.ts` — `open redirects are rejected...`                                                     | callback allowlist의 모든 malformed 입력 조합은 `lib/auth/route-handler.test.ts`에 유지한다.                                                                       |
| 테스트 인증 경계 production 차단                                  | `lib/e2e/guard.test.ts`; E2E runner의 전용 DB·HTTPS 사전 조건                                                      | 실제 production endpoint를 호출하지 않고 fail-closed 순수 경계를 전 조합으로 검증하는 편이 더 안전하다.                                                            |
| A/B 즐겨찾기·최근 검색·기본 제공사 격리, 계정 전환, 소유권        | `e2e/personalization-isolation.spec.ts` — `favorites, history, preference, and ownership stay isolated...`         | DB constraint와 repository 동시성은 `*.repository.integration.test.ts`에서 더 정밀하게 검증한다.                                                                   |
| 비로그인 local 기록·제공사 저장, 로그인 동기화, 새 context 복원   | `e2e/personalization-isolation.spec.ts` — `guest local history and provider merge...`                              | localStorage malformed/용량 예외는 storage unit 테스트에 유지한다.                                                                                                 |
| 즐겨찾기 add 5xx/401 rollback·재인증, timeout rollback            | `e2e/failure-races.spec.ts` — `favorite add rolls back...`, `favorite timeout rolls...`                            | HTTP 오류 parser의 모든 status 조합은 `lib/favorites/client.test.ts`에 유지한다.                                                                                   |
| 삭제 실패 시 항목과 순서 복원                                     | `e2e/failure-races.spec.ts` — `failed favorite deletion restores...`                                               | repository 정렬 tie-breaker는 DB integration 테스트가 담당한다.                                                                                                    |
| 인증 401·5xx·timeout과 동기화 실패 격리, retry·중복 방지          | `e2e/failure-races.spec.ts` — `auth 401...`, `auth timeout...`, `auth and merge failures remain isolated...`       | 오류 parser의 malformed payload 조합과 merge idempotency의 DB 세부사항은 auth/search-history client·service 테스트에서 검증한다.                                   |
| 최근 검색 재시도·중복·요청 순서 역전에도 최신 순서 유지           | `e2e/failure-races.spec.ts` — `auth and merge failures remain isolated...`; 격리 suite의 재접속 복원               | rapid POST 직렬화는 `components/search/MobileSearchPage.test.tsx`의 `serializes rapid authenticated history writes...`가 제어된 promise로 더 직접 검증한다.        |
| 늦은 기본 제공사 저장이 최신 선택을 덮지 않음                     | `e2e/failure-races.spec.ts` — `a slow provider write cannot overwrite...`                                          | write queue의 내부 ref/state는 검사하지 않고 최종 UI와 서버 값을 확인한다.                                                                                         |
| stale 검색 응답이 최신 결과를 덮지 않음                           | `e2e/failure-races.spec.ts` — `out-of-order search responses...`                                                   | ranking과 cursor 순서는 search 단위·통합 테스트에 유지한다.                                                                                                        |
| 이전 사용자 응답이 계정 전환 후 새 사용자 UI를 덮지 않음          | `e2e/failure-races.spec.ts` — `late response from the previous user...`                                            | 사용자 식별 ref 같은 React 내부 구현은 검사하지 않고 두 계정의 최종 화면만 확인한다.                                                                               |
| 로그아웃 중 늦은 개인화 응답 무시                                 | `e2e/failure-races.spec.ts` — `late personalization response after logout...`                                      | React 내부 state는 직접 검사하지 않고 화면·cookie·API만 본다.                                                                                                      |

## 발견한 실제 결함과 최소 수정

실제 브라우저 실행에서 두 결함을 재현했다.

1. `GET /api/auth/get-session`의 공개 응답이 session token은 제거했지만 session ID와 session metadata 객체를 브라우저에 남겼다. 응답을 allowlist된 `user` 표시 필드만 반환하도록 축소하고 route/auth integration 회귀 테스트를 강화했다.
2. 브라우저 로그아웃 요청에 JSON `Content-Type`과 body가 없어 Better Auth가 요청을 거부했고 UI가 로그인 상태로 남았다. `signOutBrowserSession`이 빈 JSON 객체를 보내도록 최소 수정하고 client 회귀 테스트를 추가했다.

## 실패 artifact와 민감정보 정책

- 로컬 HTML report: `playwright-report/`
- 로컬·CI failure screenshot: `test-results/**/test-failed-*.png`
- trace와 video: 항상 비활성화
- CI: 실패 screenshot만 `browser-e2e-failure-screenshots-<run id>` artifact로 업로드하고 7일 보존

테스트 사용자 화면 이름에는 무작위 UUID 일부만 들어가며 실제 email은 UI에 표시하지 않는다. screenshot에는 cookie 값, session token, OAuth code, access/ID token, secret을 출력하는 진단 UI가 없다. HTML report는 CI artifact로 올리지 않는다. 실패 조사 중에도 인증 응답 body나 cookie header를 로그로 출력하지 않는다.

## CI와 실행 증거 기록

`.github/workflows/browser-e2e.yml`은 PR과 `develop` push에서 별도 PostgreSQL service의 정확한 M3 테스트 DB를 준비하고 pinned lockfile 설치 후 Chromium을 설치한다. `/api/providers` readiness는 Playwright `webServer`가 기다리며 suite를 2회 실행한다. Quality와 M3 schema workflow의 lint/unit/build 및 migration constraint 책임을 중복하지 않는다.

검증 기록에는 다음을 남긴다.

- Playwright와 실제 Chromium 버전: `npx playwright --version`, browser 실행 로그
- 앱 commit: `git rev-parse HEAD`
- DB 격리: 사용한 loopback host/port와 DB 이름(자격 증명 제외)
- CI 증거: PR 생성 후 Browser E2E workflow run URL과 최종 상태

### 2026-07-21 로컬 실행 증거

- 기준: `origin/develop` `4c2fcb482145c40846e6da52cba2e658c77e9fb3`
- 런타임: Playwright `1.61.1`, Chrome for Testing `149.0.7827.55`, Chromium channel
- DB: `127.0.0.1:55432/karaoke_number_finder_m3_test` 전용 로컬 DB(자격 증명 비기록)
- 브라우저: 전체 17개 시나리오 2회 반복 `34 passed`; 느린 제공사 저장 표적 4회 `4 passed`; 이전 사용자 지연 응답 표적 4회 `4 passed`; OAuth 성공·취소·공급자 오류 표적 4회 반복 `16 passed`
- 회귀: Vitest `67 passed / 3 skipped`, assertion `533 passed / 18 skipped`; M3 DB schema/repository `22 passed`; seed search smoke `8 passed`
- 품질: ESLint, TypeScript, production build, DB validation, migration deploy, seed validation/import, `git diff --check` 통과; `npm audit` 취약점 0
- 저장소 전체 Prettier 검사는 본 작업과 무관한 기존 performance 결과 JSON·문서 12개 때문에 실패한다. 이번 변경 파일만 대상으로 한 Prettier 검사는 통과한다.

## 의도적으로 E2E에 복제하지 않은 assertion

OAuth nonce/state/PKCE/JWKS 서명, callback replay/절대 만료, 모든 잘못된 payload 조합, DB unique/FK/owner constraint, pagination/ranking tie-breaker, storage parse 예외와 React focus/flush 같은 내부 계약은 기존 단위·API·DB 통합 테스트가 더 빠르고 정확하다. E2E는 cookie jar, 실제 탐색·reload, 화면 전환, browser storage, 두 context의 격리, optimistic rollback 및 제어된 응답 순서처럼 브라우저에서만 의미 있는 관찰 결과에 한정한다.
