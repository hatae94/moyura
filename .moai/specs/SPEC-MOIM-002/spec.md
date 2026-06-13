---
id: SPEC-MOIM-002
version: "0.2.0"
status: completed
created: 2026-06-11
updated: 2026-06-13
author: hatae
priority: high
issue_number: 0
---

# SPEC-MOIM-002 — 초대 링크 + 게스트 참여

> 수락 기준(Given/When/Then): [acceptance.md](./acceptance.md) | 구현 계획: [plan.md](./plan.md)

## HISTORY

- 2026-06-13 (v0.2.0): run 완료 → status completed.
  - MoimInvite 모델 + 마이그레이션(`20260613171209_add_moim_invite`) 추가.
  - 초대 발급/목록/폐기(assertOwner 재사용) + accept(게스트/멱등/원자 usedCount) + 고정 실패 코드(404/410/409) 구현.
  - 웹 `/invite/[token]` 랜딩(익명 로그인 → nickname → accept → `/moims/[id]/chat` 리다이렉트) 구현.
  - `supabase/config.toml` `enable_anonymous_sign_ins = true` 적용.
  - 검증: jest 148/148, invite 모듈 100% stmt / 85.29% branch, backend:typecheck 0, 마이그레이션 드리프트 없음, api-client + web build/lint green.
  - TRUST 5 PASS, evaluator Security PASS(CSPRNG 토큰 / owner 전용 인가 / usedCount TOCTOU 경쟁 안전 / mass-assignment 없음).
  - 사후 수정: branch coverage 84.61→85.29(unreachable body?. null arm 제거), P2002 동시 동일 sub 멱등 처리, 경쟁 테스트 롤백 단언 강화.
- 2026-06-11 (v0.1.1): plan-auditor iteration 1 FAIL 대응 개정.
  - 헤드라인 기능(게스트 웹 랜딩 흐름)을 1급 REQ로 신설(REQ-INV-006) + AC 추가.
  - 초대 목록 접근을 owner 전용(비-owner 403)으로 명시 — 목록 응답이 live 토큰을 담는 토큰 유출 채널이므로. 목록 조회 AC 추가.
  - 복합 REQ 분리(목록 vs 폐기, 비-owner 인가 vs 멱등). 실패 클래스별 HTTP 코드 고정(404 미지/410 만료·폐기/409 max_uses).
  - REQ-INV-002에 nickname 저장 + 멱등 재수락이 usedCount를 증가시키지 않음 명시.
  - REQ 정규 텍스트에서 엔드포인트 경로·DB 연산 제거(WHAT만) — HOW는 plan.md. expiresAt 상한(최대 30일) 도입. priority 소문자화. acceptance.md 링크 추가. 각 REQ에 커버 AC ID 표기.
- 2026-06-11 (v0.1.0): 최초 작성(draft). 계획 검토 게이트에서 신규 추가된 SPEC.
  - 게이트 결정: host는 등록 사용자, 초대받은 사람은 회원가입 없이 초대 링크로 참여.
  - 게스트 신원 = Supabase **익명 로그인**(`signInAnonymously`) — 실제 sub 발급 → 가드/profile/FK/RLS 모두 무수정 동작.
  - 초대 정책: 모임당 다중 초대 링크 + 기본 7일 만료(조정 가능) + host revoke + 선택적 max_uses.
  - 표시 이름: `moim_member.nickname`(MOIM-001에서 정의) 초대 수락 시 입력.
  - 공유 리서치: [research.md](../SPEC-CHAT-001/research.md), 인터뷰: [interview.md](../SPEC-CHAT-001/interview.md).

## 1. 목표 (Goal)

모임 host가 발급한 **초대 링크**를 통해, 회원가입 없이도 사람들이 모임에 참여할 수 있게 한다. 게스트는 Supabase 익명 로그인으로 실제 `sub`를 가진 authenticated 사용자가 되어, 채팅(SPEC-CHAT-001)의 멤버십 인가·실시간 RLS·메시지 FK가 모두 무수정으로 동작한다. 이로써 모임에 **실제 참여자가 생기는 유일한 가입 경로**를 제공한다.

## 2. 배경 (Context)

- SPEC-MOIM-001은 `moim`/`moim_member` 데이터와 owner 자동 가입만 정의 — **가입 경로가 없다**.
- 게스트를 익명 Supabase 사용자로 만들면: `SupabaseAuthGuard`(검증된 sub), `ProfileService.upsertBySub`, `moim_member` FK, `realtime.messages` RLS(`auth.uid()`)가 모두 그대로 성립한다.
- 익명 사용자는 `authenticated` 롤에 속하며, JWT `is_anonymous` 클레임으로 향후 제한 가능(현재는 정보용).
- 향후 신원 연결(email/OAuth)은 익명 sub를 그대로 승격 → 멤버십·메시지가 자동 이관(데이터 무손실).
- 웹 세션은 `@supabase/ssr` 쿠키 기반(`apps/web/lib/supabase/`). 초대 랜딩에서 `signInAnonymously()` 호출로 세션 확보.

상세: 공유 리서치 [research.md](../SPEC-CHAT-001/research.md) §3.2, §5.2(RLS), §7(a).

## 3. 가정 (Assumptions)

- 로컬/호스티드 Supabase에서 익명 로그인 활성화 가능(`auth.enable_anonymous_sign_ins`).
- 초대 토큰은 추측 불가(≥128-bit 엔트로피)해야 하며, 만료/폐기/max_uses로 노출 리스크를 제한한다. 만료 기간은 owner 조정 가능하되 상한 30일(무기한 금지 — 토큰 노출 창 제한).
- 게스트 세션은 쿠키에 의존 → 쿠키 삭제 시 세션 소실(같은 링크로 **새 게스트**로 재진입, 기존 멤버십과 분리 — 문서화된 제약).

## 4. 요구사항 (EARS Requirements)

요구사항 모듈: 2개 (모듈 ≤ 5 한도 준수). 각 REQ는 단일 행위를 기술하며, 커버하는 AC ID를 함께 표기한다. 실패 클래스별 HTTP 코드는 고정한다: 미지 토큰 404 / 만료·폐기 410 / max_uses 초과 409 / 인가 실패 403.

### 모듈 A — 초대 관리 (owner 전용)

#### REQ-INV-001 [Event-driven] — 초대 링크 발급
**When** 모임 owner가 초대 발급을 요청하면, 시스템은 추측 불가한 토큰(≥128-bit 엔트로피)과 만료 시각(기본 발급 시점 +7일, owner 조정 가능, 상한 30일)과 선택적 사용 횟수 제한을 가진 초대를 생성하고 토큰을 반환한다(shall). — AC: AC-1

#### REQ-INV-002 [Event-driven] — 초대 목록 조회 (owner 전용)
**When** 모임 owner가 자기 모임의 초대 목록을 요청하면, 시스템은 해당 모임의 초대 목록(상태 포함)을 반환한다(shall). — AC: AC-6

#### REQ-INV-003 [Event-driven] — 초대 폐기 (owner 전용)
**When** 모임 owner가 초대 폐기를 요청하면, 시스템은 해당 초대를 폐기 상태로 표시한다(shall). — AC: AC-4

#### REQ-INV-004 [Unwanted] — 비-owner 초대 관리 차단
**If** owner가 아닌 사용자가 초대 발급·목록 조회·폐기 중 하나를 시도하면, **then** 시스템은 처리 없이 403으로 거부한다(초대 목록 응답은 live 토큰을 담으므로 토큰 유출 방지를 위해 조회도 owner로 제한한다). — AC: AC-5

### 모듈 B — 초대 수락 (게스트 가입)

#### REQ-INV-005 [Event-driven] — 초대 수락 + 게스트 가입
**When** 인증된 사용자가 유효 토큰과 nickname으로 초대 수락을 요청하면, 시스템은 토큰을 검증한 뒤 해당 nickname을 가진 멤버십을 생성하고 사용 횟수를 1 증가시킨다(shall). 이미 멤버인 사용자가 재수락하면, 시스템은 중복 멤버십을 만들지 않고 사용 횟수도 증가시키지 않는다(멱등). — AC: AC-2, AC-7

#### REQ-INV-006 [State-driven] — 유효하지 않은 토큰 거부
**While** 토큰이 미지·만료·폐기·사용 횟수 초과 중 하나의 상태인 동안, 시스템은 수락 요청에 대해 멤버십을 생성하지 않고 고정 코드로 거부한다(미지 404 / 만료·폐기 410 / 초과 409). — AC: AC-3

#### REQ-INV-007 [Event-driven] — 게스트 웹 랜딩 흐름
**When** 세션이 없는 사용자가 초대 랜딩 페이지를 열면, 시스템은 익명 인증 세션을 확보하고 nickname 입력을 수집하여 수락을 제출한 뒤 대상 모임의 채팅 화면으로 이동시킨다(shall). — AC: AC-8

## 5. 비범위 (Exclusions — What NOT to Build)

- **게스트→정회원 전환 UI** — 익명 신원 연결(email/OAuth)은 Supabase가 sub 승격으로 데이터를 자동 이관(설명만, 전용 UI는 비범위).
- **초대 QR 코드** 생성.
- **email/SMS 초대 발송** — 링크 공유는 host가 외부 채널로 수동 수행.
- **per-invite 역할 지정** — 수락자는 항상 `role=member`.
- **초대 분석/통계**(클릭 수, 유입 출처 등).

## 6. 변경 마커 (Delta Markers — Brownfield)

- [MODIFY] `apps/backend/prisma/schema.prisma` — `MoimInvite` 모델 추가
- [MODIFY] `apps/backend/src/app.module.ts` — `InviteModule` import (또는 MoimModule 확장)
- [MODIFY] `supabase/config.toml` — `auth.enable_anonymous_sign_ins = true`
- [NEW] `apps/backend/prisma/migrations/<ts>_add_moim_invite/`
- [NEW] `apps/backend/src/invite/**` — module/service/controller/dto
- [NEW] `apps/web/app/invite/[token]/page.tsx` + 수락 로직
- [REGEN] `apps/backend/openapi.json` + `packages/api-client`

## 7. 의존성 (Dependencies)

- 선행 SPEC: **SPEC-MOIM-001 완료** (`moim`/`moim_member`, `assertMember`, owner role).
- 기존 자산: `SupabaseAuthGuard`, `ProfileService.upsertBySub`, 웹 `lib/supabase/client.ts`(`@supabase/supabase-js` 2.106.2 — `signInAnonymously` 지원), `@supabase/ssr` 세션.
- 외부 셋업: 호스티드 환경에서 Supabase 대시보드 익명 로그인 활성화(로컬은 config.toml).

## 8. 품질 게이트 (Quality Gate)

- 백엔드: jest TDD, 커버리지 85%+ (토큰 검증·멱등·403 경로).
- 웹: 테스트 하니스 없음 → `nx build web` + `lint`만 (기존 합의).
- 토큰 엔트로피 검증(≥128-bit), 만료/폐기/max_uses 단위 테스트.

## Implementation Notes (as-implemented)

### 생성 파일

- `apps/backend/src/invite/invite.module.ts` — InviteModule (MoimModule import, assertOwner 재사용)
- `apps/backend/src/invite/invite.service.ts` — 발급/목록/폐기/accept 로직, usedCount 원자 증가
- `apps/backend/src/invite/invite.controller.ts` — REST 라우트 5개(POST 발급, GET 목록, DELETE 폐기, POST accept, GET 단건)
- `apps/backend/src/invite/dto/` — 발급/수락 요청·응답 DTO
- `apps/backend/src/invite/invite.service.spec.ts`, `invite.controller.spec.ts`, `invite.integration.spec.ts`
- `apps/backend/prisma/migrations/20260613171209_add_moim_invite/` — MoimInvite 테이블 + token UNIQUE INDEX + Cascade FK
- `apps/web/app/invite/[token]/page.tsx` — 웹 랜딩 페이지
- `apps/web/lib/invite/accept.ts` — 수락 클라이언트 로직

### 수정 파일

- `apps/backend/prisma/schema.prisma` — `MoimInvite` 모델 추가 + `Moim.invites` 관계 필드(additive)
- `apps/backend/src/app.module.ts` — `InviteModule` import 추가
- `supabase/config.toml` — `enable_anonymous_sign_ins = true`, `anonymous_users = 30`(시간당 IP별 rate limit)

### 수정 사항 (X-1~X-4)

- **X-1**: 만료·폐기 응답을 `HttpException`에서 `GoneException`으로, 중복 멤버 응답을 `ConflictException`으로 교체(NestJS 표준 예외 계층).
- **X-2**: api-client 재생성 단계를 `api-client:build` → `api-client:generate` + `api-client:typecheck`로 정정.
- **X-3**: `Moim.invites` 관계 필드 추가를 additive(기존 필드 보존)로 처리.
- **X-4**: 로컬 Supabase 재시작을 `npx supabase stop && npx supabase start`로 처리.

### 사후 수정 (post-eval)

- branch coverage 84.61%→85.29%: `invite.controller.ts` `body?.expiresAt`, `body?.maxUses`, `body?.nickname` optional chaining의 unreachable null arm(`body` 항상 객체) 제거.
- P2002 동시 동일 sub 멱등 처리: `accept`에서 `P2002`(unique 제약 위반) catch → 기존 멤버십 반환(idempotent).
- 경쟁 테스트 롤백 단언 강화: `invite.integration.spec.ts` 경쟁 케이스에서 rollback 시 `usedCount` 불변 단언 추가.

### 크로스 SPEC 참고

- `/moims/[id]/chat` 리다이렉트 대상(SPEC-CHAT-001)은 현재 미구현이며, 웹 랜딩에서 해당 경로 문자열을 사용하는 것은 적절(빌드 타임 오류 없음). CHAT-001 구현 후 실제 동작 확인 필요.

### 남용 완화 (Abuse Mitigations)

- `anonymous_users = 30`: 시간당 IP별 익명 가입 30회 제한(Supabase 내장 rate limit).
- `maxUses`: 초대당 최대 수락 횟수 제한(선택 설정, 초과 시 409).
- `expiresAt` 상한: 최대 30일(무기한 초대 금지 — 토큰 노출 창 제한).
- `revokedAt`: host가 언제든 초대 즉시 폐기 가능.

### Evaluator INFO

- `invite.service.ts` `updateMany` WHERE 절에 redundant OR arm 존재 — 런타임에 무해한 dead branch. Istanbul branch hit 미반영(harmless, 수정 보류).
