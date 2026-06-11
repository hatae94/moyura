# Plan — SPEC-MOIM-002 (초대 링크 + 게스트 참여)

> 공유 리서치: [research.md](../SPEC-CHAT-001/research.md) | 인터뷰: [interview.md](../SPEC-CHAT-001/interview.md)

## 구현 접근

모임의 유일한 가입 경로를 구현한다. 핵심은 (1) 추측 불가 토큰 기반 초대 레지스트리, (2) Supabase 익명 로그인으로 게스트를 실제 authenticated 사용자로 만들어 기존 인증/RLS/FK를 무수정 재사용하는 것. host 인가는 MOIM-001의 `assertOwner`(owner 전용 작업)로 처리한다. 발급·목록·폐기는 전부 owner 전용(목록 응답이 live 토큰을 담으므로 조회도 제한).

## REQ → 구현 매핑

| REQ | 엔드포인트 / 구현 지점 | 실패 코드 |
|-----|------------------------|-----------|
| REQ-INV-001 (발급) | `POST /moims/:id/invites` → `InviteService.create()` (assertOwner) | 비-owner 403, 만료>30d 400 |
| REQ-INV-002 (목록) | `GET /moims/:id/invites` → `InviteService.list()` (assertOwner) | 비-owner 403 |
| REQ-INV-003 (폐기) | `DELETE /moims/:id/invites/:inviteId` → `InviteService.revoke()` (assertOwner) | 비-owner 403 |
| REQ-INV-004 (비-owner 차단) | 위 3개 모두 `assertOwner` 선검사 | 403 |
| REQ-INV-005 (수락+멱등) | `POST /invites/:token/accept` → `InviteService.accept()` | (성공 200) |
| REQ-INV-006 (무효 토큰) | `accept()` 토큰 검증 분기 | 미지 404 / 만료·폐기 410 / 초과 409 |
| REQ-INV-007 (웹 랜딩) | `apps/web/app/invite/[token]/page.tsx` | (성공 redirect) |

## 마일스톤 분할 (run 단계)

### M1 — 초대 모델 + 발급/목록/폐기 (RED → GREEN)
- `schema.prisma`에 `MoimInvite` 추가 → `prisma migrate dev --name add_moim_invite`
- `InviteService.create(sub, moimId, { expiresAt?, maxUses? })` — `assertOwner` + crypto 토큰(≥128-bit) 생성, 만료 상한 30일 강제(초과 400)
- `InviteService.list(sub, moimId)`, `InviteService.revoke(sub, inviteId)` — 전부 `assertOwner`
- 토큰 엔트로피·비-owner 403(발급/목록/폐기 전부)·만료 상한 단위 테스트

### M2 — 초대 수락 + 게스트 가입 (백엔드)
- `InviteService.accept(sub, token, nickname)` — 토큰 검증 → 멤버십 생성(nickname 저장) + usedCount 조건부 원자 증가
- 멱등 처리(이미 멤버면 중복 row 금지 + usedCount 불변), 무효 토큰 고정 코드(미지 404 / 만료·폐기 410 / 초과 409)
- `POST /invites/:token/accept` 컨트롤러(가드 적용 — 익명 사용자도 authenticated)
- 미지/만료/폐기/초과/멱등(usedCount 불변) 단위 테스트

### M3 — 웹 초대 랜딩
- `supabase/config.toml`에서 `enable_anonymous_sign_ins = true`
- `apps/web/app/invite/[token]/page.tsx`: 세션 없으면 `supabase.auth.signInAnonymously()` → nickname 입력 → api-client로 accept 호출 → `/moims/:id/chat` 리다이렉트
- `nx build web` + `lint`

### M4 — 계약 재생성 + 품질 게이트
- `app.module.ts` 등록, openapi → api-client 재생성, typecheck/test 85%+

## 기술 스택 / 의존성 (production stable only)

- 신규 백엔드 라이브러리 없음. 토큰 생성은 Node 내장 `crypto.randomBytes(32)`(256-bit) → base64url.
- 웹: 이미 설치된 `@supabase/supabase-js 2.106.2`(`signInAnonymously` 지원), `@supabase/ssr 0.10.3`, `next 16.2.6`.

## Prisma 모델 (초안)

```prisma
model MoimInvite {
  token     String   @id            // crypto.randomBytes(32) base64url, 추측 불가
  moimId    String
  createdBy String   // owner profile.id
  expiresAt DateTime                 // 기본 now()+7d (서비스에서 주입), 상한 now()+30d
  maxUses   Int?                     // null = 무제한
  usedCount Int      @default(0)
  revokedAt DateTime?
  createdAt DateTime @default(now())
  moim      Moim @relation(fields: [moimId], references: [id], onDelete: Cascade)
  @@index([moimId])
  @@map("moim_invite")
}
```
(MOIM-001 `Moim`에 `invites MoimInvite[]` 역참조 추가 필요 → MOIM-001 모델 수정 또는 본 SPEC에서 relation 보강)

## 리스크 분석 + 완화

| # | 리스크 | 완화 |
|---|--------|------|
| 익명 abuse | 익명 가입 무제한 생성 가능 | Supabase IP당 시간당 익명 가입 rate limit(`anonymous_users = 30`), maxUses/만료로 초대별 제한, 선택적 captcha를 고려사항으로 문서화 |
| 토큰 유출 | 링크가 외부 유출 + 목록 응답의 live 토큰 노출 | 만료(기본 7d, 상한 30d) + host revoke + 선택적 maxUses로 노출 창 제한; 초대 목록 조회를 owner 전용으로 제한(REQ-INV-004) |
| 게스트 세션 소실 | 쿠키 삭제 시 게스트 신원 소실 | 문서화된 제약 — 같은 링크로 **새 게스트**로 재진입(기존 멤버십과 분리). 신원 연결은 향후. |
| owner 인가 누락 | 비-owner가 발급/목록/폐기 | `assertOwner`(MOIM-001 @MX:ANCHOR)를 발급·목록·폐기 전부에 강제(403) |
| 무기한 토큰 | owner가 만료를 과도하게 길게 설정 | 만료 상한 30일 강제(초과 400) |
| 동시 수락 race | maxUses 경계 동시 초과 | usedCount 증가를 조건부 update(원자) 또는 트랜잭션으로 처리 |

## 생성/수정 파일

- [MODIFY] `apps/backend/prisma/schema.prisma` (`MoimInvite` + `Moim.invites`)
- [NEW] `apps/backend/prisma/migrations/<ts>_add_moim_invite/migration.sql`
- [NEW] `apps/backend/src/invite/invite.module.ts`, `invite.service.ts`, `invite.controller.ts`, `dto/*.ts`
- [NEW] `apps/backend/src/invite/invite.service.spec.ts`
- [MODIFY] `apps/backend/src/app.module.ts`
- [MODIFY] `supabase/config.toml` (`enable_anonymous_sign_ins = true`)
- [NEW] `apps/web/app/invite/[token]/page.tsx` (+ `apps/web/lib/invite/accept.ts` 헬퍼)
- [REGEN] `apps/backend/openapi.json`, `packages/api-client/src/schema.d.ts`

## MX 태그 계획 (mx_plan)

- `@MX:ANCHOR` — `InviteService.accept()`: 게스트 가입 진입점(웹 랜딩이 의존, 멱등·검증 계약).
- `@MX:WARN` (+ `@MX:REASON`) — 토큰 생성부: 엔트로피 부족 시 초대 추측 가능 → `crypto.randomBytes(32)` 고정, 약한 난수 사용 금지.
- `@MX:NOTE` — `signInAnonymously()` 호출 지점(웹): 게스트가 실제 sub를 받아 가드/RLS/FK가 무수정 동작하는 설계 의도 + 쿠키 소실 시 새 게스트 제약.
- `@MX:NOTE` — owner 인가가 `assertOwner`(MOIM-001 @MX:ANCHOR)를 재사용하는 의존 지점(발급·목록·폐기 공통).
- `@MX:NOTE` — `InviteService.list()`: 응답이 live 토큰을 담으므로 owner 전용임을 명시(토큰 유출 채널 차단).

## 참조 (Reference)

- Reference: `apps/backend/src/profile/profile.service.ts` / `profile.service.spec.ts` — 서비스 + 단위 테스트 패턴
- Reference: `apps/backend/src/auth/supabase-auth.guard.ts` — 가드(익명 사용자도 검증된 sub로 통과)
- Reference: `apps/web/lib/supabase/client.ts`, `apps/web/lib/supabase/server.ts` — 브라우저/서버 Supabase 클라이언트 (`signInAnonymously` 호출 지점)
- Reference: `apps/web/lib/auth/actions.ts` — 웹 세션 액션 패턴
- Reference: `apps/web/app/auth/callback/route.ts` — 세션 확보 후 리다이렉트 패턴
- Reference: `supabase/config.toml` line 184 — `enable_anonymous_sign_ins` 토글 위치
- Reference (선행): `.moai/specs/SPEC-MOIM-001/spec.md` — `assertOwner`(owner 인가), `assertMember`, owner role
