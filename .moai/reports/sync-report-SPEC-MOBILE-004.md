# Sync Report — SPEC-MOBILE-004

생성일: 2026-06-15
브랜치: feature/SPEC-MOBILE-004 (SPEC-MOBILE-004 run이 이 브랜치에서 완료됨)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOBILE-004/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0, updated: 2026-06-15), HISTORY v0.2.0 항목 추가(자동 게이트 GREEN + device-gated 미충족 이유 명시) |
| `CHANGELOG.md` | 수정 | [Unreleased] > Added에 MOBILE-004 항목 추가(네이티브 Google 로그인 + 이름 온보딩, 게이트 결과 포함) |
| `.moai/project/structure.md` | 수정 | mobile hooks/lib 항목(useAuthBridge 설명 + google-signin-core/signin-id-token-core 코어 파일), web lib/auth(require-named-session.ts), web app/(main)/layout.tsx 설명, web app/onboarding/ 신규 라우트, web app/me/ 설명, backend profile/ 설명(PATCH /me + UpdateNameDto), prisma/ 마이그레이션 목록, 워크스페이스 패키지 표 mobile 행(신규 의존성), RN 웹뷰 현황 타이틀 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOBILE-004 요약 추가, 구현됨 vs 계획됨 표에 MOBILE-004 행 추가, mobile 프레임워크 표 의존성 행 갱신, 설정 파일 위치 표에 MOBILE-004 관련 파일 6건 추가 |
| `.moai/project/db/schema.md` | 수정 | last_synced_at 갱신(2026-06-15), Tables 요약 표 profile 설명 갱신, profile 테이블 정의에 `name` 컬럼(TEXT, NULLABLE) 추가, moim_member nickname 설명 갱신(profile.name과 역할 구분 명시) |
| `.moai/project/db/erd.mmd` | 수정 | 최종 갱신 주석 갱신, PROFILE 엔티티에 `name` 필드(nullable) 추가 |
| `.moai/project/db/migrations.md` | 수정 | Applied Migrations에 `20260615000000_add_profile_name` 행 추가, Pending Migrations에 동일 마이그레이션 prod 항목 추가, Rollback Notes에 DROP COLUMN 절차 추가 |
| `.moai/reports/sync-report-SPEC-MOBILE-004.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`
- **이유**: 디바이스 검증 게이트 정책(`mobile-spec-device-gated` 프로젝트 메모리)에 따라 자동화 가능한 게이트는 전부 GREEN이나, 아래 AC들이 EAS dev build + 실 Google 계정 + Google Cloud OAuth 클라이언트 ID 없이 검증 불가하여 `in-progress` 유지.

**자동 게이트 결과 (재실행 없이 인용)**:

| 게이트 | 결과 |
|--------|------|
| backend jest | 214/214 PASS, branch coverage 85.36% |
| mobile vitest | 187/187 PASS |
| tsc (backend/web/api-client) | 0 errors |
| web build (`next build`) | OK |
| expo export | OK |
| prisma migrate status | clean |
| evaluator-active | Overall PASS — Func 75 / Sec 75 / Craft 75 / Consistency 90 |

**device-gated AC (completed 전환 미충족 항목)**:

| AC | 미충족 이유 |
|----|------------|
| AC-1: Google 버튼 → 네이티브 SDK 진입 | EAS dev build 필요(네이티브 모듈, Expo Go 불가) |
| AC-2: signInWithIdToken Supabase 세션 획득 | 실 Google 계정 + Google Cloud OAuth 클라이언트 ID 필요 |
| AC-3: session:restore 주입 + 웹 세션 확립 | AC-1/2 선행 필요 |
| AC-5: 구글 계정 이름 prefill | AC-1/2 선행 필요 |
| AC-6a: 취소 시 로그인 페이지 복귀 | EAS dev build 필요 |
| AC-6b: signInWithIdToken 실패 에러 표시 | EAS dev build 필요 |

**completed 전환 조건**: 위 6개 AC를 실 기기/EAS dev build에서 수동 확인 후.

이 패턴은 SPEC-MOBILE-001/002/003(OAuth 라운드트립 대기), SPEC-CHAT-001/002(realtime/FCM 실기기 대기)와 동일한 정책을 따른다.

---

## 3. CHANGELOG 업데이트 요약

`[Unreleased] > Added` 섹션 맨 앞(최신 순)에 MOBILE-004 항목을 삽입했다.

포함 내용:
- backend Profile.name(nullable) + 마이그레이션 + PATCH /me + UpdateNameDto + ProfileResponseDto.name
- web signUpAction 이름 배선 + onboarding/ 라우트 + require-named-session.ts 가드
- mobile google-signin-core/signin-id-token-core 순수 vitest 코어 + SDK 래퍼 + useAuthBridge.ts 전환
- 신규 의존성(@react-native-google-signin/google-signin@16.1.2 + @supabase/supabase-js@2.106.2 mobile)
- 자동 게이트 결과 및 device-gated 상태 명시

---

## 4. structure.md / tech.md 증분 업데이트 요약

### structure.md

- backend `profile/` 항목: `updateName`, `PATCH /me`, `UpdateNameDto` 추가.
- backend `prisma/` 마이그레이션 목록: `20260615000000_add_profile_name` 추가.
- mobile `hooks/useAuthBridge.ts`: oauth-intercept → 네이티브 경로 전환 설명 추가.
- mobile `lib/auth/`: `google-signin-core.ts`, `google-signin.ts`, `signin-id-token-core.ts`, `supabase-mobile.ts` 추가.
- web `lib/auth/`: `require-named-session.ts` 추가.
- web `app/`: `onboarding/` 신규 라우트 추가, `me/` 설명에 가드 적용 명시.
- web `app/(main)/layout.tsx`: `require-named-session` 가드 적용 명시.
- 워크스페이스 패키지 표 mobile 행: `@react-native-google-signin/google-signin@16.1.2` + `@supabase/supabase-js@2.106.2` 추가, status 갱신.
- RN 웹뷰 현황 타이틀: SPEC-MOBILE-004 상태 반영.

### tech.md

- 상단 SPEC 기록 블록: SPEC-MOBILE-004 요약(게이트 결과, 구현 내용, device-gated 이유) 추가.
- 구현됨 vs 계획됨 표: `IMPLEMENTED (SPEC-MOBILE-004, in-progress)` 행 신규 추가.
- mobile 프레임워크 표: `@react-native-google-signin/google-signin@16.1.2` + `@supabase/supabase-js@2.106.2` 의존성 추가, 특이사항 갱신.
- 설정 파일 위치 표: add_profile_name 마이그레이션, UpdateNameDto, require-named-session.ts, onboarding/, google-signin-core, signin-id-token-core 6건 추가.

---

## 5. DB 문서 업데이트 요약

### schema.md

- `last_synced_at`: 2026-06-14 → 2026-06-15.
- Tables 요약: `profile` 설명에 `name(nullable)` 추가 명시.
- `profile` 테이블 정의: `name TEXT NULLABLE` 컬럼 행 추가(설명: provider 비종속, NULL = 온보딩 미완료 기준).
- `moim_member.nickname` 설명: profile.name과 역할 구분 명시(전역 이름 vs 모임 내 표시 이름).

### erd.mmd

- 최종 갱신 주석: 2026-06-14 → 2026-06-15, SPEC-MOBILE-004 내용 명시.
- PROFILE 엔티티: `string name "사용자 이름 (nullable, SPEC-MOBILE-004)"` 필드 추가.

### migrations.md

- Applied Migrations: `20260615000000_add_profile_name`(profile.name nullable 추가) 행 추가.
- Pending Migrations: 동일 마이그레이션의 prod 미배포 항목 추가.
- Rollback Notes: `ALTER TABLE profile DROP COLUMN name;` 절차 추가(최신 순 상단 삽입).

---

## 6. 크로스-SPEC 후속 과제 (cross-SPEC follow-up)

**[후속-MEDIUM] `apps/web/app/moims/[id]/chat/page.tsx` (SPEC-CHAT-001) — 이름 온보딩 가드 미적용**

현재 `apps/web/app/moims/[id]/chat/page.tsx`는 `require-named-session` 가드(또는 동등한 로직)를 적용하지 않는다. 이 경로는 `(main)` 라우트 그룹 밖이므로 `(main)/layout.tsx`에 추가한 가드의 적용 범위에 포함되지 않는다.

영향: `Profile.name`이 null인 사용자(온보딩 미완료)가 직접 `/moims/[id]/chat` URL로 진입할 경우 온보딩 없이 채팅 페이지에 도달할 수 있다.

권고: 별도 SPEC에서 `apps/web/app/moims/[id]/chat/page.tsx`에 `require-named-session`(또는 동등한 서버 가드)을 적용하여 이름 없는 사용자가 채팅 페이지에 직접 진입하지 못하도록 차단해야 한다. SPEC-MOBILE-004 범위를 벗어나므로 이 SPEC에서는 미수정.

---

## 7. evaluator-active 어드바이저리 (비차단, 재확인 불필요)

evaluator-active 보고서(`.moai/reports/evaluator/SPEC-MOBILE-004-final-pass.md`)의 LOW/INFO 항목:

| 항목 | 분류 | 판정 |
|------|------|------|
| `requireNonEmpty` 비-string 브랜치 미테스트 | LOW | device/타입 경계 — TypeScript strict 환경에서 non-string 진입 불가(런타임 안전). 단위 테스트 경로 없음은 수용 가능 |
| Android 취소 코드 `"12501"` 미테스트 | INFO | Android 제외 user directive(2026-06-12, `ios-simulator-only` 프로젝트 메모리). Android-gated — 현재 정책상 대기 수용 가능 |
| `runOAuthBridge` 폴백 경로 의도적 보존 | INFO | 네이티브 경로 실패 시 브라우저 OAuth 폴백 — 의도적 설계(SPEC-MOBILE-004 §5 실패 경로). 제거 대상 아님 |

모두 비차단 — TRUST 5 기준 수용 가능.

---

status: sync complete (SPEC-MOBILE-004 v0.2.0, in-progress)
