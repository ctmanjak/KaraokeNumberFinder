# 관리자 전용 노래 추가 기능

## 범위

`/admin/songs/new`에서 관리자가 곡 기본 정보, 추가 검색 별칭, 제공사별 예약 번호를 한 번에 등록한다. 기존 곡 수정·삭제, 제공사 관리, 자동 크롤링과 관리자 역할 변경 UI는 포함하지 않는다.

## 권한 모델

- `users.role`은 `user` 또는 `admin`이며 migration 기본값은 항상 `user`다.
- 브라우저의 `is_admin`은 메뉴와 화면 표시용이다. 실제 `GET /api/admin/songs`, `GET /api/admin/songs/options`, `POST /api/admin/songs`는 유효한 DB session의 user ID로 `users.role`을 다시 조회한다.
- `ADMIN_CATALOG_MODE=on`인 경우에만 관리자 카탈로그 page/API를 처리한다. production에서 mode가 누락되거나 잘못되면 `off`로 닫히며, local/test harness는 `on`을 명시한다.
- `POST`는 기존 보호 API와 같은 same-origin, `Sec-Fetch-Site`, `x-knf-request` CSRF 경계를 사용한다.
- 관리자 역할을 요청 본문, OAuth profile 또는 공개 환경변수에서 받지 않는다.
- 생성 데이터의 `verified_by`는 서버가 `admin:<user UUID>`로 기록한다.

## 배포와 최초 관리자 지정

1. production이 아닌 일회용 DB에서 migration과 회귀 테스트를 먼저 실행한다.
2. `20260722090000_add_admin_role` migration을 배포한다. 기존 사용자도 모두 `user`가 된다.
3. 승인된 운영자가 대상 환경과 정확한 계정을 재확인한 뒤 transaction 안에서 한 사용자만 승격한다. 이메일과 실행 결과는 저장소나 로그에 남기지 않는다.

```sql
BEGIN;
SELECT id, role FROM users WHERE email = '<approved-admin-email>' FOR UPDATE;
UPDATE users SET role = 'admin', updated_at = NOW()
WHERE email = '<approved-admin-email>' AND role = 'user';
COMMIT;
```

승격 후 로그아웃·로그인 또는 session 새로고침으로 메뉴를 갱신한다. 권한 회수는 같은 방식으로 정확한 사용자를 잠근 뒤 `role = 'user'`로 되돌린다. 역할 변경 전후에는 대상 환경, 대상 사용자 수가 정확히 1명인지 확인한다.

## 생성 계약

- 한 transaction에서 관리자 권한, 중복 곡, 활성 제공사를 확인하고 `Song`, `SongAlias`, `KaraokeEntry`를 생성한다.
- 원제(`canonical_title`), 표시 제목(`display_title`), 가수(`artist`) 별칭은 자동 생성된다.
- `available` 항목에는 예약 번호가 필수이고 다른 상태에는 예약 번호를 허용하지 않는다.
- 동일 원제와 가수의 기존 곡은 `409 DUPLICATE_SONG`, 비활성·없는 제공사는 `422 PROVIDER_NOT_FOUND`로 거부한다.
- transaction은 `Serializable` 격리 수준을 사용하며 unique/serialization 충돌은 안전한 `409` 응답으로 변환한다.

## 검증

```bash
npm run db:validate
npm run typecheck
npm run lint
npm run test
npm run build
```

실제 migration과 생성 통합 테스트는 승인된 localhost 일회용 PostgreSQL에서 수행한다. staging·production DB에 테스트 곡이나 테스트 관리자를 만들지 않는다.
