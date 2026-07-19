# M3-T02 인증·사용자 데이터 migration 적용 및 복구 절차

- 대상 migration: `20260718121000_add_auth_user_data_schema`
- 작성일: 2026-07-18
- 범위: Prisma schema, 신규 인증·개인화 테이블, 제약조건과 인덱스만 포함
- 범위 밖: OAuth route/callback, cookie, 로그인 UI, 보호 API, 개인화 service, cleanup job

## 의존성 결정

2026-07-18 기준 Better Auth 최신 안정 1.6 patch는 `1.6.23`이다. `1.7`은 공식 upgrade guide에서 release candidate로 안내되므로 선택하지 않았다.

- `better-auth`: `1.6.23` exact pin
- `@better-auth/prisma-adapter`: `1.6.23` exact pin
- `@testing-library/dom`: 기존 `@testing-library/react` peer `10.4.1`을 dev dependency로 명시해 npm의 optional peer 재해석 후에도 기존 UI 테스트 타입을 보존
- 기존 `@prisma/client`, `prisma`, `@prisma/adapter-pg`: lockfile 해석 결과 모두 `7.8.0`
- auth UI/client 전용 dependency: 추가하지 않음

공식 Prisma adapter `1.6.23`의 peer range는 Prisma `^5 || ^6 || ^7`이고, 공식 문서는 Prisma 7 custom client output을 사용할 때 `@prisma/client` 대신 생성 경로에서 `PrismaClient`를 import하도록 안내한다. 이 저장소는 기존대로 `lib/generated/prisma/client`와 `PrismaPg` adapter를 사용한다.

참고:

- <https://better-auth.com/changelog>
- <https://better-auth.com/docs/adapters/prisma>
- <https://better-auth.com/docs/concepts/database>
- <https://better-auth.com/docs/guides/1-7-upgrade-guide>

## T01 설계와 실제 schema 대응

| 모델             | 실제 구현          | 주요 제약과 T01 대응                                                                                  |
| ---------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `User`           | `users`            | UUID PK, email unique, Account/Session/Preference/Favorite/SearchHistory 관계                         |
| `Account`        | `accounts`         | `(providerId, accountId)` unique, `userId` index, User 삭제·ID 갱신 cascade                           |
| `Session`        | `sessions`         | token unique, `(userId, expiresAt)` 및 `expiresAt` index, User cascade                                |
| `Verification`   | `verifications`    | `identifier`, `expiresAt` 각각 index, cleanup job은 후속 범위                                         |
| `UserPreference` | `user_preferences` | `userId` PK+FK, provider nullable FK, provider 삭제 SetNull·ID 갱신 cascade                           |
| `Favorite`       | `favorites`        | `(userId, songId)` unique, 사용자 최신순 `(userId, createdAt DESC, id DESC)` index, User/Song cascade |
| `SearchHistory`  | `search_histories` | `(userId, normalizedQuery)` unique, 최신순 `(userId, searchedAt DESC, id DESC)` index, User cascade   |

모든 시간 필드는 PostgreSQL `TIMESTAMPTZ(6)`이고, 테이블·컬럼·constraint·index 이름은 기존 규칙대로 plural `snake_case`를 사용한다. 기존 `Song`, `SongAlias`, `KaraokeProvider`, `KaraokeEntry`의 문자열 ID와 테이블 정의는 변경하지 않았다.

### Better Auth 공식 core schema와의 조정

Better Auth `1.6.23` 공식 CLI가 생성한 Prisma core schema와 T01 초안을 비교해 다음을 적용했다.

- `User.emailVerified`: T01의 nullable timestamp 대신 Better Auth 필수 boolean과 일치하도록 `Boolean @default(false)`를 사용한다. Google identity는 여전히 email이 아니라 `(providerId, accountId)`의 Google `sub`를 기준으로 한다.
- `User.name`: T01의 nullable 초안 대신 Better Auth 필수 string과 일치하도록 non-null로 저장한다.
- `Account.password`: Better Auth core schema 호환을 위해 nullable로 유지하되 email/password provider는 활성화하지 않는다.
- `Account.tokenType`: T01 OAuth field 계약을 보존하는 nullable 확장 필드다. Better Auth core가 사용하지 않아도 adapter 동작에는 영향을 주지 않는다.
- `(providerId, accountId)` unique와 cleanup/pagination index는 Better Auth 기본 생성본보다 강한 제품 제약으로 추가한다.

## ID 형식

신규 인증·개인화 entity는 모두 PostgreSQL native UUID를 사용한다.

- `User`, `Account`, `Session`, `Verification`, `Favorite`, `SearchHistory`: `String @id @default(uuid()) @db.Uuid`
- `UserPreference.userId`: `User.id`를 그대로 사용하는 UUID PK/FK
- 기존 Song/Provider ID: 기존 `VARCHAR` 형식을 그대로 유지

UUID는 auth entity 간 타입을 일관되게 유지하고 기존 seed에서 관리하는 의미 기반 문자열 ID와 충돌하지 않는다. Better Auth 공식 UUID 모드를 사용할 수 있으므로 M3-T03 auth 설정은 `advanced.database.generateId: "uuid"`를 사용해야 한다. ID를 email이나 OAuth account ID로 대체하지 않는다.

## Migration 안전성 정적 검토

신규 SQL은 다음 작업만 수행한다.

1. 신규 테이블 7개 생성
2. 신규 테이블의 PK/unique/index 생성
3. 신규 테이블에서 `users`, `songs`, `karaoke_providers`로 FK 추가

기존 테이블/컬럼/row를 변경하거나 삭제하는 `DROP`, `TRUNCATE`, `DELETE`, destructive `ALTER`는 없다. PostgreSQL diff 생성 시 Prisma schema로 표현할 수 없는 기존 `song_aliases_normalized_alias_trgm_idx`를 `DROP INDEX`하라는 제안이 나왔으나, M2 검색 index와 ranking을 보존하기 위해 의도적으로 migration에서 제외했다.

`prisma/migrations/migration_lock.toml`은 기존 migration 디렉터리에 빠져 있던 Prisma 표준 provider lock이며 DB object를 변경하지 않는다.

## 적용 절차

공유·운영 DB에는 먼저 승인된 backup/PITR 지점과 `DATABASE_URL` 대상 환경을 확인한다. 임의의 production URL이나 개인 로컬 환경을 추론해서 사용하지 않는다.

```bash
npm ci
npm run db:validate
npm run db:generate
npx prisma migrate status
npx prisma migrate deploy
```

운영에서는 `prisma migrate dev`, `db push`, `migrate reset`을 사용하지 않는다. 적용 순서는 기존 두 migration 다음에 `20260718121000_add_auth_user_data_schema`다.

적용 후 다음을 확인한다.

```bash
npx prisma migrate status
npm test
npm run typecheck
npm run lint
npm run build
```

DB catalog에서는 신규 테이블 7개, 명시된 FK/unique/index, 기존 Song/Provider row 수와 `song_aliases_normalized_alias_trgm_idx` 존속을 확인한다.

## 격리 DB 리허설

2026-07-18 PostgreSQL 16 일회용 로컬 DB `karaoke_number_finder_m3_test`에서 다음을 완료했다.

1. 기존 migration 2개 적용
2. M3-T02 migration 적용
3. Prisma Client 생성과 schema validation
4. Account/Session/Favorite/SearchHistory unique 위반 확인
5. User 삭제 시 Account/Session/Preference/Favorite/SearchHistory cascade 확인
6. Provider ID 변경 시 UserPreference cascade, provider 삭제 시 SetNull 확인
7. Favorite/SearchHistory 최신순 DESC index와 Session/Verification cleanup index 확인
8. 사용자 삭제가 Song row를 삭제하지 않는지 확인

통합 테스트는 `M3_TEST_DATABASE_URL`이 정확히 localhost의 `karaoke_number_finder_m3_test`를 가리킬 때만 실행된다. 다른 host 또는 DB 이름이면 즉시 거부한다. 전용 명령은 해당 DB에 모든 migration을 먼저 배포한 다음 PostgreSQL 제약조건 테스트를 실행한다.

```bash
M3_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/karaoke_number_finder_m3_test \
  npm run test:m3-db
```

GitHub Actions의 `.github/workflows/m3-schema.yml`도 PostgreSQL 16 service에서 같은 명령을 실행하므로, migration 적용 및 실제 FK·unique·cascade·index 검증은 pull request에서 별도 DB-backed job으로 실행된다.

## 실패 시 복구와 down SQL 초안

자동 rollback migration은 제공하지 않는다. migration 적용 중 실패하면 다음 순서로 처리한다.

1. 애플리케이션 배포와 신규 auth/user-data write를 중지한다.
2. `prisma migrate status`, `_prisma_migrations`와 PostgreSQL catalog에서 migration이 실패 상태인지 성공 상태인지, 실제 생성된 object가 무엇인지 확인한다.
3. 신규 사용자 데이터가 기록되었다면 먼저 export하거나 승인된 backup/PITR로 복원한다. 데이터가 있는 상태에서 아래 down SQL을 즉시 실행하지 않는다.
4. 원인을 수정해 forward migration으로 완료하는 방식을 우선한다.
5. migration이 **실패 상태**이고 부분 생성 object를 제거해야 재실행할 수 있을 때만 아래 down SQL 초안을 별도 검토 후 실행한다. 제거가 완료된 뒤 `prisma migrate resolve --rolled-back 20260718121000_add_auth_user_data_schema`로 실패 record를 rolled back 처리하고 `prisma migrate deploy`로 재적용한다.
6. migration이 이미 **성공 상태**라면 `migrate resolve --rolled-back`을 사용할 수 없다. 이 경우 승인된 backup/PITR 복원을 우선하고, DB 복원 없이 되돌려야 한다면 아래 SQL을 수동 실행하지 말고 별도의 검토된 revert migration으로 만들어 migration history에 기록한다.

Down SQL 초안은 실패한 migration의 부분 적용 정리 또는 별도 revert migration 검토를 위한 참고 자료다. 신규 테이블만 역의존 순서로 제거하며 기존 검색 object는 건드리지 않는다.

```sql
BEGIN;

DROP TABLE IF EXISTS "search_histories";
DROP TABLE IF EXISTS "favorites";
DROP TABLE IF EXISTS "user_preferences";
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "accounts";
DROP TABLE IF EXISTS "verifications";
DROP TABLE IF EXISTS "users";

COMMIT;
```

부분 적용 실패라면 존재하는 object와 `_prisma_migrations` 상태가 다를 수 있으므로, 위 SQL과 `migrate resolve`를 자동화하거나 무조건 실행하지 않는다. Prisma는 성공한 migration을 `--rolled-back`으로 resolve할 수 없으므로, 성공 상태에서 수동 down SQL을 실행해 schema와 migration history를 분리하지 않는다.

## M3-T03 입력 사항

- `better-auth`와 공식 Prisma adapter는 `1.6.23`을 유지하고 custom-output `PrismaClient` + 기존 `PrismaPg` singleton을 전달한다.
- `advanced.database.generateId: "uuid"`를 설정한다.
- `emailAndPassword`와 Google 외 provider를 활성화하지 않는다.
- Google account identity는 `(providerId="google", accountId=sub)`를 사용하며 email collision을 자동 병합하지 않는다.
- DB session을 사용하고 stateless JWT와 session cookie cache를 활성화하지 않는다.
- OAuth token을 브라우저에 노출하지 않고, Google API scope/offline access/refresh-token 동작을 추가하지 않는다.
- 공개 search/provider route가 auth 모듈을 import하지 않는 경계를 유지한다.
