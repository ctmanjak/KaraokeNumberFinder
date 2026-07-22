# M3-T03 Google OAuth 및 세션 설정·검증

- 범위: Better Auth 1.6.23 Google authorization-code flow, callback 검증, PostgreSQL session, logout
- 범위 밖: 로그인 UI, 보호 API 공통 경계, Favorite/SearchHistory/UserPreference API, cleanup job
- auth route: `/api/auth/[...all]`

## 확정 결정 (2026-07-18)

1. 로그인 시작은 Better Auth 공식 client contract를 따른다. same-origin `POST /api/auth/sign-in/social`은 검증된 Google authorization URL을 `200` JSON `{ url, redirect: true }`로 반환하고, Better Auth client가 `window.location`을 이동시킨다. URL 안의 state, nonce, S256 PKCE challenge는 OAuth/OIDC front-channel 값으로 허용한다.
2. callback request에 유효한 이전 session이 있으면 신규 callback 처리를 계속하기 전에 이전 Session row를 먼저 폐기한다. 조회 또는 폐기에 실패하면 fail closed로 로그인을 중단하고 신규 Session을 만들지 않는다. 이전 세션 폐기 후 후속 OAuth 처리가 실패하면 사용자는 비로그인 상태가 될 수 있으며, 세션 고정 방지를 이 UX보다 우선한다.

Authorization code는 Google이 exact callback URI로 반환하는 callback query에서만 받아 즉시 서버 교환에 사용하며 application JSON, 로그, analytics 또는 로그인 완료 redirect에 전달하지 않는다. PKCE verifier, OAuth token, ID token과 session token은 JSON, URL, 로그, analytics 또는 JavaScript-readable 영구 저장소에 노출하지 않는다.

## 환경 변수

| 변수                        | 의미                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`        | cookie 서명·암호화 secret. 32자 이상이며 환경별로 별도 관리하고 production에서는 문서의 placeholder 값을 거부한다. |
| `BETTER_AUTH_URL`           | 앱의 exact origin. path/query/hash를 포함하지 않는다.                                                              |
| `AUTH_TRUSTED_ORIGIN`       | 허용할 exact same origin. wildcard를 금지하며 현재는 `BETTER_AUTH_URL`과 같아야 한다.                              |
| `GOOGLE_CLIENT_ID`          | Google OAuth Web client ID.                                                                                        |
| `GOOGLE_CLIENT_SECRET`      | Google OAuth Web client secret.                                                                                    |
| `GOOGLE_OAUTH_CALLBACK_URL` | `${BETTER_AUTH_URL}/api/auth/callback/google`과 정확히 같아야 한다.                                                |

production에서는 URL 세 개가 HTTPS여야 한다. local development에서는 `localhost`, `127.0.0.1`, `[::1]`의 HTTP만 예외로 허용한다. 필수 값 누락, wildcard origin, 다른 origin, URL credential, callback path 불일치는 auth route에서 fail closed한다. 공개 search/provider route는 auth 환경을 읽지 않는다.

Google Cloud의 OAuth Web application에는 환경별 callback URI를 exact 값으로 등록한다.

```text
http://localhost:3000/api/auth/callback/google
https://YOUR_PRODUCTION_ORIGIN/api/auth/callback/google
```

## Better Auth와 Prisma 연결

`lib/auth/server.ts`는 기존 `lib/db/prisma.ts`의 `PrismaPg` singleton과 custom-output `lib/generated/prisma/client`를 재사용한다. 공식 `@better-auth/prisma-adapter`에는 `provider: "postgresql"`, `transaction: true`를 전달해 신규 OAuth User와 Account 생성이 transaction 경계 안에서 처리되게 한다. auth entity ID는 `advanced.database.generateId: "uuid"`다.

활성 인증 방식은 Google 하나다. email/password, client ID-token sign-in, Google 외 provider와 HTTP account-link route는 열지 않는다. HTTP auth 경계는 다음 route만 허용한다.

- `POST /api/auth/sign-in/social`
- `GET /api/auth/callback/google`
- `GET /api/auth/get-session`
- `POST /api/auth/sign-out`

## OAuth 검증

로그인 시작 body의 `callbackURL`은 `/`, `/favorites`, `/settings` 중 하나인 exact 상대 경로만 허용한다. absolute URL, protocol-relative URL, query/hash, percent-encoding, backslash, dot-segment와 다른 path는 로그인 시작 전에 거부한다. error callback은 서버가 `/`로 고정한다.

Google 요청은 `response_type=code`, `scope=openid email profile`, S256 PKCE, state, nonce, 환경별 exact redirect URI를 사용한다. `access_type=offline`, 추가 scope, login hint와 client-provided ID token은 받지 않는다. Better Auth가 만든 authorization URL도 provider origin/path, client ID, redirect URI, scope, state, PKCE를 다시 검사한 뒤에만 same-origin `200` JSON `{ url, redirect: true }`로 반환한다. Better Auth client는 이 URL로 top-level navigation을 수행한다.

State와 nonce는 요청·callback·ID token을 결속하는 단기 일회용 상관값이고 PKCE challenge는 verifier에서 파생된 공개값이므로 Google authorization URL에 포함되는 것이 프로토콜상 정상이다. 이 세 값은 검증된 authorization URL 외의 application JSON, 로그, analytics 또는 영구 browser storage에 별도로 기록하지 않는다. PKCE verifier는 서버 Verification에만 보관한다.

Better Auth 1.6.23 기본 callback은 authorization-code 경로에서 Google ID token을 decode해 profile을 만들지만 `verifyIdToken()`을 호출하지 않는다. 이를 보완하기 위해 custom Google `getUserInfo`가 설치된 `verifyGoogleIdToken`을 호출하고 다음을 모두 확인한다.

- Google JWKS signature
- exact issuer `https://accounts.google.com`
- exact audience `GOOGLE_CLIENT_ID`
- `exp`, `iat`, 최대 1시간 token age
- 로그인 state에 서버가 넣은 nonce exact match
- `email_verified=true`
- non-empty Google `sub`와 email

identity는 `(providerId="google", accountId=sub)`다. email은 unique contact/profile 값일 뿐 identity가 아니다. 동일 email에 다른 sub가 도착하면 Better Auth implicit linking을 비활성화한 상태에서 `ACCOUNT_CONFLICT`로 안전하게 중단하며 User, Account, Session을 추가하지 않는다.

state payload와 PKCE verifier/nonce는 10분짜리 database `Verification` row에 저장되고 state 값은 별도 signed HttpOnly cookie로 브라우저에 결속된다. 기본 state cookie의 5분 max-age는 명시적으로 10분으로 맞춘다. callback 후 Better Auth row가 삭제되며, 별도 hashed replay guard를 callback 전에 원자적으로 consume해 동시에 재사용된 callback도 하나만 통과시킨다. cleanup job은 이 티켓 범위 밖이다.

## OAuth token 저장

Google API를 호출하지 않으므로 Account create/update database hook은 `accessToken`, `refreshToken`, `idToken`, token expiry, scope를 모두 `null`로 만든다. account cookie도 비활성화한다. Authorization code는 exact callback query에서만 받아 서버가 즉시 교환하고 application JSON, 로그, analytics와 로그인 완료 redirect에 전달하지 않는다. PKCE verifier, OAuth token, ID token과 session token은 JSON 응답, URL 또는 application log에 기록하지 않는다. State, nonce와 PKCE challenge는 검증된 Google authorization URL에만 포함하며 application log, analytics와 JavaScript-readable 영구 저장소에 기록하지 않는다. Better Auth logger는 argument를 버리고 고정된 내부 event만 기록한다.

## Session과 cookie

- 저장: PostgreSQL `sessions` row와 signed opaque session cookie
- idle expiry: 7일
- refresh window: 마지막 expiry 기준 24시간이 지난 유효 session만 갱신
- absolute expiry: `createdAt + 30일`
- cookie cache/JWT/stateless session: 비활성
- 로그인: callback request에 유효한 이전 session이 있으면 해당 row를 먼저 폐기한다. 조회·폐기 실패 시 로그인을 중단하며, 성공한 경우에만 새 random token을 발급한다.
- logout: POST만 허용하며 Better Auth가 DB row 삭제를 먼저 시도하고 동일 속성의 만료 cookie를 반환
- DB 삭제 실패: token이나 DB 오류를 응답하지 않고 browser cookie는 계속 만료

refresh database hook은 요청된 7일 연장을 absolute expiry로 cap한다. `/get-session` 응답 guard는 내부 session의 `expiresAt`으로 cookie Max-Age/Expires를 조정하되, 공개 JSON은 allowlist된 `user` 표시 필드만 반환하고 `session` 객체 전체를 제거한다. 만료되거나 삭제된 row는 이전 cookie로 재사용할 수 없다.

production build의 HTTPS 배포(staging과 production) cookie는 `__Host-knf.session_token`, Secure, HttpOnly, SameSite=Lax, Path=/, Domain 미설정이다. Better Auth가 custom 이름 앞에 `__Secure-`를 추가하지 않도록 automatic secure prefix는 끄고, 모든 cookie 속성에 `Secure`를 명시해 exact `__Host-` 이름과 조건을 함께 만족시킨다. local HTTP에서는 `knf-dev.session_token`과 non-Secure 속성을 사용하며 배포 설정을 약화시키지 않는다.

## 운영·보안 절차

### 환경 설정과 exact redirect

1. 환경마다 별도의 Google OAuth Web client, `BETTER_AUTH_SECRET`, DB와 배포 환경변수 scope를 사용한다. staging 값을 production scope에 복사하거나 두 환경이 같은 DB를 공유하지 않는다.
2. `BETTER_AUTH_URL`과 `AUTH_TRUSTED_ORIGIN`은 해당 배포의 exact HTTPS origin으로 같게 설정한다. `GOOGLE_OAUTH_CALLBACK_URL`은 그 origin의 `/api/auth/callback/google`과 정확히 같아야 한다.
3. Google Cloud에는 같은 exact callback URI만 등록한다. wildcard, preview 전체를 포괄하는 pattern, forwarded host 추론은 사용하지 않는다.
4. 변경은 staging에서 auth route fail-closed, 공개 검색 독립성, 실제 로그인·로그아웃을 확인한 뒤 별도 승인된 production 배포로 승격한다. 값 자체를 티켓, 로그, screenshot, 채팅에 기록하지 않는다.

### Secret rotation

- `GOOGLE_CLIENT_SECRET`: 제공사에서 새 secret을 생성하고 대상 환경의 secret store를 새 값으로 갱신한 뒤 재배포한다. staging 로그인과 callback을 먼저 확인하고, 승인된 production 검증이 끝난 뒤 이전 secret을 폐기한다. client ID나 redirect URI 변경은 별도 변경으로 검토한다.
- `BETTER_AUTH_SECRET`: 현재 구현은 단일 active secret만 지원한다. 교체하면 기존 signed state/session cookie가 유효하지 않게 되므로 계획된 전체 로그아웃으로 취급한다. 로그인 write를 잠시 중지하고 대상 환경의 backup/PITR 지점을 확인한 뒤 secret을 갱신·재배포하며, 승인된 운영자가 같은 환경의 기존 `sessions`와 `verifications` row를 정리한다. 이 절차는 자동 dual-key 무중단 rotation이 아니다.
- 긴급 유출 대응: 영향 환경의 로그인 진입을 중지하고 Google client secret과 `BETTER_AUTH_SECRET`을 모두 교체한다. 기존 session·verification을 강제 폐기하고 공개 검색은 계속 제공한다. production secret/DB 작업은 incident owner의 명시적 승인과 감사 기록 없이는 수행하지 않는다.

### 세션 폐기와 만료 row 정리

- 사용자 logout은 현재 session row를 삭제하고 동일 cookie를 만료시킨다. 로그인 callback은 기존 session을 먼저 폐기하고 새 식별자를 발급한다.
- 사용자 전체 또는 환경 전체 강제 로그아웃을 위한 admin API는 현재 없다. 필요한 경우 승인된 운영자가 대상 환경과 사용자 범위를 재확인한 뒤 transaction 안에서 `sessions`를 user ID로 제한 삭제하거나 전체 삭제한다. session token/cookie 값으로 대상을 찾거나 값을 증거에 복사하지 않는다.
- `Session`과 `Verification`의 정기 hard-delete job은 아직 구현되지 않았다. 만료 row는 인증에 사용할 수 없지만 보존될 수 있다. 운영 owner는 배포 환경 확정 후 최소 보존 기간, batch delete, 관측·실패 재시도와 audit 정책을 후속 티켓으로 구현해야 한다.

### 장애 격리, 증거와 금지 작업

- 인증 또는 개인화 장애 시 해당 UI를 unavailable/retry 상태로 두고 공개 `/api/search`와 `/api/providers`를 auth/session 모듈이나 개인화 transaction에 연결하지 않는다.
- 로그와 screenshot에는 email, 계정 식별자, query parameter 값, authorization code, state/nonce, cookie, access/ID/refresh token, client secret, DB URL을 남기지 않는다. auth logger는 현재 고정된 내부 event만 기록한다.
- production에서는 E2E 제어 endpoint 활성화, migration/seed/rollback 리허설, 장애 주입, fixture 생성, 사용자 데이터 검사·정리를 금지한다. `docs/m3-t13-browser-e2e.md`의 전용 loopback DB guard를 사용한다.
- 남은 운영 결정의 owner는 repository/배포 운영자다. 정기 Session/Verification cleanup과 dual-key `BETTER_AUTH_SECRET` rotation이 필요해지면 별도 티켓으로 추적한다.

## 실제 Google 수동 검증

실제 credential은 자동 테스트에 사용하지 않는다. 배포 환경에서 다음을 수동 확인한다.

1. Google Cloud에 환경의 exact callback URI를 등록한다.
2. secret과 Google credential을 secret manager/배포 환경 변수로 주입한다.
3. Better Auth client로 `POST /api/auth/sign-in/social`을 same-origin 호출하고 `200` JSON이 검증된 Google URL과 `redirect: true`만 포함하는지, 이어진 consent 화면의 scope가 `openid email profile`뿐인지 확인한다. Authorization code, PKCE verifier와 OAuth/session token은 응답에 없어야 한다.
4. 로그인 성공 후 `/api/auth/get-session`이 새로고침 간 유지되고 JSON의 최상위 값이 allowlist된 `user`뿐이며 `session`, token, secret과 authorization code가 없는지 확인한다.
5. Google 취소가 `/?auth_error=OAUTH_FAILED`로 돌아오며 비로그인 검색이 동작하는지 확인한다.
6. `POST /api/auth/sign-out` 후 같은 browser cookie로 session을 재사용할 수 없는지 확인한다.
7. production build HTTPS 응답 cookie의 exact 이름과 Secure/HttpOnly/SameSite/Path/Domain 미설정을 browser devtools에서 확인한다.

실제 callback의 Google 서명/JWKS, consent UX와 Google Cloud redirect 등록은 credential이 있는 배포 환경에서만 완전히 확인할 수 있다. 자동 테스트는 token endpoint, verified claims, fake clock과 저장소를 주입해 같은 경계를 검증한다.

## M3-T04 입력 계약

T04는 `getServerAuth()` 또는 `getServerAuthRuntime().auth`를 서버에서만 사용해 `auth.api.getSession({ headers })`로 database session을 검증할 수 있다. 브라우저용 `/get-session`은 allowlist된 `user` 표시 필드만 반환하므로 보호 API의 권위 경계로 사용하지 않는다. 공통 `requireUser`/`requireSession`, mutation CSRF helper, 보호 API 오류 envelope는 T04에서 구현하며 이번 티켓에는 포함하지 않는다.
