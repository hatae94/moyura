# Plan — SPEC-MOIM-001 (모임 도메인)

> 공유 리서치: [research.md](../SPEC-CHAT-001/research.md) | 인터뷰: [interview.md](../SPEC-CHAT-001/interview.md)

## 구현 접근

모임 도메인 데이터 모델 + 멤버십 인가 단일 출처를 확립한다. 가입 경로는 MOIM-002로 위임하므로, 본 SPEC은 데이터 구조 + owner 자동 가입 + 모임 라이프사이클(생성/조회/삭제) + 멤버 한정 조회 + 탈퇴(owner 금지)만 구현한다(update 비범위). 기존 `Profile`/auth 패턴을 그대로 따른다.

## REQ → 구현 매핑

| REQ | 구현 지점 |
|-----|-----------|
| REQ-MOIM-001 (인증) | 전 라우트 `@UseGuards(SupabaseAuthGuard)` |
| REQ-MOIM-002 (비멤버 조회 403) | `MoimService.assertMember()` |
| REQ-MOIM-003 (owner 전용 삭제 403) | `MoimService.assertOwner()` |
| REQ-MOIM-004 (생성+자동 멤버십) | `MoimService.createMoim()` |
| REQ-MOIM-005 (조회 단건/목록) | `MoimService.getMoim()` / `listMyMoims()` |
| REQ-MOIM-006 (멤버 목록) | `MoimService.listMembers()` |
| REQ-MOIM-007 (탈퇴) | `MoimService.leave()` (owner면 거부) |
| REQ-MOIM-008 (owner 탈퇴 금지) | `MoimService.leave()` 내 owner 가드 → 403 |

## 마일스톤 분할 (run 단계)

### M1 — 모델 + 핵심 서비스 (RED → GREEN)
- `schema.prisma`에 `Moim`, `MoimMember`(nickname 포함) 추가
- `prisma migrate dev --name add_moim`(로컬 `:54322`)
- `MoimService.createMoim(sub, name, nickname)` — moim + owner moim_member 트랜잭션 생성
- `MoimService.getMoim(sub, moimId)` / `listMyMoims(sub)` — 멤버 한정 조회
- `MoimService.listMembers(sub, moimId)` — nickname 포함 멤버 목록
- `MoimService.leave(sub, moimId)` — owner면 403, 아니면 moim_member 삭제
- jest 단위 테스트(Prisma jest.Mock 스텁, `profile.service.spec.ts` 스타일)

### M2 — 인가 + 컨트롤러
- `MoimService.assertMember(sub, moimId)` — 비멤버 시 403, 미인증은 가드가 401 선처리
- `MoimService.assertOwner(sub, moimId)` — 비-owner 시 403 (삭제 인가)
- `moim.controller.ts`: `POST /moims`, `GET /moims`, `GET /moims/:id`, `GET /moims/:id/members`, `DELETE /moims/:id`(owner 전용), `DELETE /moims/:id/membership`(owner 금지)
- 전 라우트 `@UseGuards(SupabaseAuthGuard)` + `@CurrentUser()`
- 401/403(비멤버·비owner·owner-leave) 구분 테스트, 비멤버 탈퇴 404

### M3 — 계약 재생성 + 품질 게이트
- `app.module.ts`에 `MoimModule` 등록
- `backend:openapi` → `api-client:generate` 재생성
- `typecheck` + `test`(커버리지 85%+) 검증

## 기술 스택 / 의존성 (production stable only)

- 신규 라이브러리 없음. 기존 `@nestjs/common ^11`, `@prisma/client 7.8.0`, `@prisma/adapter-pg 7.8.0`, `pg 8.21.0` 사용.
- Prisma 모델 패턴: `@@map()` snake_case, PK 명시, `@default(now())`, `onDelete: Cascade`.

## Prisma 모델 (초안)

```prisma
model Moim {
  id        String   @id @default(uuid())
  name      String
  createdBy String   // profile.id (Supabase sub)
  createdAt DateTime @default(now())
  members   MoimMember[]
  @@map("moim")
}

model MoimMember {
  moimId   String
  userId   String   // profile.id
  nickname String   // 모임별 표시 이름 (게이트 결정 — profile name 부재 보완)
  role     String   @default("member") // "owner" | "member"
  joinedAt DateTime @default(now())
  moim     Moim @relation(fields: [moimId], references: [id], onDelete: Cascade)
  @@id([moimId, userId])
  @@map("moim_member")
}
```

## 리스크 분석 + 완화

| # | 리스크 | 완화 |
|---|--------|------|
| R-5 | 모임 삭제 시 멤버/메시지 Cascade 삭제 | MVP는 `onDelete: Cascade` 명시 채택. 아카이빙 요구 시 별도 SPEC. |
| 인가 중복 | CHAT/MOIM-002가 멤버십 검사를 각자 구현하면 드리프트 | `assertMember()`를 단일 출처로 export(@MX:ANCHOR). 하위 SPEC 재사용. |
| nickname 누락 | host 생성 시 nickname 미입력 | DTO 필수 검증(non-empty), 생성 트랜잭션에서 owner row에 주입. |
| owner-leave 고아 모임 | owner 탈퇴 시 모임이 owner 없이 남음 | REQ-MOIM-008로 owner 탈퇴 차단(403). owner 퇴장은 모임 삭제(Cascade). 소유권 이양은 비범위. |

## 생성/수정 파일

- [MODIFY] `apps/backend/prisma/schema.prisma`
- [NEW] `apps/backend/prisma/migrations/<ts>_add_moim/migration.sql`
- [NEW] `apps/backend/src/moim/moim.module.ts`
- [NEW] `apps/backend/src/moim/moim.service.ts`
- [NEW] `apps/backend/src/moim/moim.controller.ts`
- [NEW] `apps/backend/src/moim/dto/create-moim.dto.ts`, `dto/moim-response.dto.ts`, `dto/member-response.dto.ts`
- [NEW] `apps/backend/src/moim/moim.service.spec.ts`
- [MODIFY] `apps/backend/src/app.module.ts`
- [REGEN] `apps/backend/openapi.json`, `packages/api-client/src/schema.d.ts`

## MX 태그 계획 (mx_plan)

- `@MX:ANCHOR` — `MoimService.assertMember(sub, moimId)`: 멤버십 인가 단일 출처. CHAT-001/CHAT-002/MOIM-002가 의존(fan_in ≥ 3 예상). 인가 계약으로 고정.
- `@MX:ANCHOR` — `MoimService.assertOwner(sub, moimId)`: owner 인가(삭제·향후 owner 전용 작업). MOIM-002 초대 발급/폐기가 재사용.
- `@MX:ANCHOR` — `MoimService.createMoim()`: moim + owner 멤버십 원자 생성 진입점.
- `@MX:NOTE` — `MoimService.leave()`: owner 탈퇴 차단(REQ-MOIM-008) 의도 — 고아 모임 방지, 퇴장은 삭제 경로.
- `@MX:NOTE` — `MoimModule` 도메인 경계 의도 + owner 자동 가입 규칙; `MoimMember.nickname`이 profile name 부재를 보완하는 표시 이름 출처임을 명시.

## 참조 (Reference)

- Reference: `apps/backend/src/profile/profile.service.ts` — 서비스 + 검증된 sub만 사용(mass-assignment 차단) 패턴
- Reference: `apps/backend/src/profile/profile.service.spec.ts` — jest Prisma 스텁 단위 테스트 패턴
- Reference: `apps/backend/src/auth/supabase-auth.guard.ts`, `apps/backend/src/auth/current-user.decorator.ts` — 가드 + `@CurrentUser()` 재사용
- Reference: `apps/backend/src/profile/me.controller.ts` — per-route `@UseGuards` 컨트롤러 패턴
- Reference: `apps/backend/prisma/schema.prisma` — `@@map`, source-emit 클라이언트 패턴
