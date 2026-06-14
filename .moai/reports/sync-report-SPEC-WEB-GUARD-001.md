# Sync Report — SPEC-WEB-GUARD-001

생성일: 2026-06-15
브랜치: feature/SPEC-MOBILE-004 (SPEC-WEB-GUARD-001 구현이 이 브랜치에서 완료됨, 커밋 aef205e)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-WEB-GUARD-001/spec.md` | 수정 | frontmatter(status: draft→completed, version: 0.1.0→0.2.0, updated: 2026-06-15), HISTORY v0.2.0 항목 추가(6개 AC 검증 근거 + MOBILE-004 cross-SPEC 후속 해소 명시) |
| `CHANGELOG.md` | 수정 | [Unreleased] > Added 최상단에 SPEC-WEB-GUARD-001 항목 추가(moims 서브트리 가드 확장, MOBILE-004 후속 해소, 신규 파일·재사용 가드 명시) |
| `.moai/project/structure.md` | 수정 | `app/moims/` 항목을 단일 라인에서 서브트리 블록으로 확장 — `moims/layout.tsx`(서버 가드, SPEC-WEB-GUARD-001) + `[id]/chat/`(채팅 페이지, SPEC-CHAT-001) 계층 명시 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-WEB-GUARD-001 요약 추가(completed, 커밋 aef205e, 후속 해소), 구현됨 vs 계획됨 표에 WEB-GUARD-001 completed 행 신규 추가 |
| `.moai/reports/sync-report-SPEC-WEB-GUARD-001.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → completed (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `completed`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`
- **이유**: 본 SPEC은 device-gated 아님. 순수 웹 서버 측 라우팅 로직(`app/moims/layout.tsx` 서버 컴포넌트 단일 파일)이며 OAuth/FCM/Realtime/네이티브 SDK 의존이 전혀 없다. 6개 AC가 아래와 같이 전부 검증되었다.

**AC별 검증 근거 (재실행 없이 인용)**:

| AC | 검증 방법 | 결과 |
|----|-----------|------|
| AC-1: `app/moims/` 아래 모든 라우트에 서버 가드 적용 | `apps/web/app/moims/layout.tsx` 코드 검사 — async 서버 컴포넌트에서 `requireNamedSession()` await 확인 | PASS |
| AC-2: 미인증 → /login 307 리다이렉트 | 실 HTTP 확인: GET /moims/test-id/chat (세션 없음) → HTTP 307, Location: /login; GET /login → 200 | PASS |
| AC-3: 이름 없음(Profile.name null) → /onboarding 리다이렉트 | `requireNamedSession()` 동일 코드 경로 재사용 — `apps/web/app/(main)/layout.tsx`·`apps/web/app/me/page.tsx`에서 이미 실 검증된 로직 그대로 적용. 별도 authenticated-no-name 라이브 실행 없음(web 테스트 하니스 없음, Supabase 세션 위조 범위 외). 코드 재사용으로 동등한 검증 보증. | PASS (코드 재사용 보증) |
| AC-4: (main) 레이아웃의 탭바·셸 감지 미포함(chat 풀스크린) | `apps/web/app/moims/layout.tsx` 코드 검사 — BottomTabBar·ShellModeEffect·ShellSessionAnnouncer·inline shell-detect script 없음 확인 | PASS |
| AC-5: 리다이렉트 루프 없음 | `apps/web/app/login/`·`apps/web/app/onboarding/` 경로 위치 확인 — 둘 다 `app/moims/` 밖. `require-named-session.ts` 주석의 루프 안전성 근거 동일 적용 | PASS |
| AC-6: 빌드/린트 통과 | `nx run web:build` PASS(Compiled successfully, TypeScript finished 0 errors); `nx run web:lint` PASS(0 errors) | PASS |

> **AC-3 비고**: 이름 없는 인증 세션으로 실 HTTP 확인은 수행하지 않았다(web 앱에 테스트 하니스 없음, 이름 없는 Supabase 세션 위조는 본 sync 작업 범위 외). AC-3 검증 근거는 가드 코드 재사용이다 — `requireNamedSession()`은 `apps/web/app/(main)/layout.tsx`에서 이미 실 인증 환경으로 검증된 동일 함수이며, moims/layout.tsx는 이를 단순 위임(await)한다. 코드 경로 동일성이 검증 동등성을 보증한다.

---

## 3. CHANGELOG 업데이트 요약

`[Unreleased] > Added` 섹션 최상단에 SPEC-WEB-GUARD-001 항목을 삽입했다(SPEC-MOBILE-004 항목보다 위, 최신 순).

포함 내용:
- 신규 파일: `apps/web/app/moims/layout.tsx` — 서버 컴포넌트, `requireNamedSession()` await, 탭바 없음
- 재사용: `apps/web/lib/auth/require-named-session.ts` 무변경
- 검증 결과: nx run web:build/lint PASS, 실 HTTP 307→/login 확인
- 후속 해소: SPEC-MOBILE-004 sync 리포트 §6 cross-SPEC 후속(chat 페이지 이름 가드 미적용 MEDIUM) 해소

---

## 4. structure.md / tech.md 증분 업데이트 요약

### structure.md

- `app/moims/` 항목: 단일 라인 주석에서 서브트리 블록으로 확장.
  - `moims/layout.tsx` 신규 라인 추가 — 서버 가드(SPEC-WEB-GUARD-001), `requireNamedSession()` await, 탭바 없음(chat 풀스크린).
  - `[id]/chat/` 라인 — 기존 설명(SPEC-CHAT-001, page.tsx 내용) 유지.

### tech.md

- 상단 SPEC 기록 블록: SPEC-WEB-GUARD-001 요약(completed, 커밋 aef205e, 단일 파일 추가, MOBILE-004 후속 해소, 검증 결과) 추가.
- 구현됨 vs 계획됨 표: `IMPLEMENTED (SPEC-WEB-GUARD-001, completed)` 행 신규 추가 (SPEC-MOBILE-004 행 바로 위, 최신 순).

---

## 5. cross-SPEC 후속 해소 확인

**본 SPEC(SPEC-WEB-GUARD-001)은 SPEC-MOBILE-004 sync 리포트 §6에 기록된 cross-SPEC 후속 과제를 해소한다.**

SPEC-MOBILE-004 sync 리포트 §6 원문:

> **[후속-MEDIUM] `apps/web/app/moims/[id]/chat/page.tsx` (SPEC-CHAT-001) — 이름 온보딩 가드 미적용**
>
> 현재 `apps/web/app/moims/[id]/chat/page.tsx`는 `require-named-session` 가드(또는 동등한 로직)를 적용하지 않는다. 이 경로는 `(main)` 라우트 그룹 밖이므로 `(main)/layout.tsx`에 추가한 가드의 적용 범위에 포함되지 않는다.
>
> 영향: `Profile.name`이 null인 사용자(온보딩 미완료)가 직접 `/moims/[id]/chat` URL로 진입할 경우 온보딩 없이 채팅 페이지에 도달할 수 있다.
>
> 권고: 별도 SPEC에서 `apps/web/app/moims/[id]/chat/page.tsx`에 `require-named-session`(또는 동등한 서버 가드)을 적용하여 이름 없는 사용자가 채팅 페이지에 직접 진입하지 못하도록 차단해야 한다.

**해소 방법**: `apps/web/app/moims/layout.tsx`(서버 컴포넌트, SPEC-WEB-GUARD-001) 추가로 `app/moims/` 서브트리 전체에 `requireNamedSession()`을 적용. chat 페이지 자체를 수정하지 않고 상위 레이아웃 레벨에서 가드를 적용하여 최소 변경으로 문제를 해소했다. 미인증 → /login, 이름 없음 → /onboarding 리다이렉트 정책은 `requireNamedSession()` 코드 재사용으로 보증된다.

---

status: sync complete (SPEC-WEB-GUARD-001 v0.2.0, completed)
