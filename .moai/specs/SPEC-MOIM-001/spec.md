---
id: SPEC-MOIM-001
version: "0.1.1"
status: draft
created: 2026-06-11
updated: 2026-06-11
author: hatae
priority: high
issue_number: 0
---

# SPEC-MOIM-001 — 모임 도메인 (Moim CRUD + 멤버십)

> 수락 기준(Given/When/Then): [acceptance.md](./acceptance.md) | 구현 계획: [plan.md](./plan.md)

## HISTORY

- 2026-06-11 (v0.1.1): plan-auditor iteration 1 FAIL 대응 개정.
  - REQ 모듈을 2개(인증·인가 / 모임 라이프사이클·멤버십)로 그룹화하고, 복합 REQ(탈퇴+멤버목록)를 원자 REQ로 분리.
  - CRUD 스코프 정합: 모임 조회(단건/목록)·삭제(owner 전용) REQ 신설, update는 비범위 유지. 제목 정합.
  - owner-leave 모순 해소(게이트 결정): owner는 자기 모임을 탈퇴할 수 없다(403); 소유권 이양은 비범위; 모임 삭제가 owner의 퇴장 경로.
  - REQ 정규 텍스트에서 구현 식별자(가드 클래스명) 제거 — WHAT만 기술, HOW는 plan.md.
  - 각 REQ에 커버 AC ID 명시(REQ↔AC 1:1+). priority 소문자화. acceptance.md 링크 추가.
- 2026-06-11 (v0.1.0): 최초 작성(draft). 인터뷰 4개 결정 + 계획 검토 게이트 승인 반영.
  - 게이트 결정: self-join 제거 — 가입 경로는 전적으로 SPEC-MOIM-002 책임(초대 링크 + 게스트 참여).
  - `MoimMember.nickname`(모임별 표시 이름) 추가 — profile에 name 필드 부재 보완, 채팅 sender 표시 해석 출처.
  - 공유 리서치: [research.md](../SPEC-CHAT-001/research.md), 인터뷰: [interview.md](../SPEC-CHAT-001/interview.md).

## 1. 목표 (Goal)

모임/멤버 데이터 경계를 확립한다. 모임 라이프사이클(생성·조회·삭제)과 멤버십 데이터(누가 어느 모임의 멤버인가 + 모임별 nickname)를 책임지며, 채팅(SPEC-CHAT-001)·초대(SPEC-MOIM-002)·푸시(SPEC-CHAT-002)가 이 경계에 의존한다. **가입 경로(어떻게 멤버가 되는가)는 본 SPEC 범위가 아니다**(MOIM-002). 모임 수정(update)도 비범위.

## 2. 배경 (Context)

- moyura 백엔드(NestJS 11 + Prisma 7)에는 현재 `Profile` 모델만 존재(`apps/backend/prisma/schema.prisma`).
- `Profile`에는 표시 이름 필드가 없다 → 채팅 sender 표시를 위해 모임별 `nickname`을 `moim_member`에 둔다(게이트 결정).
- 인증 자산(검증된 사용자 신원 추출 가드, `@CurrentUser()`)은 SPEC-AUTH-001에서 완료 → 본 SPEC은 **재사용만** 한다(구체 클래스는 plan.md).
- 멤버십 인가는 본 SPEC이 단일 출처로 제공하고, CHAT-001/CHAT-002/MOIM-002가 재사용한다(구체 함수는 plan.md).

상세 통합 지점·리스크는 공유 리서치 [research.md](../SPEC-CHAT-001/research.md) §2, §7(a)(d), §8 참조.

## 3. 가정 (Assumptions)

- `moim_member.user_id`와 `profile.id`는 모두 Supabase `sub`(uuid 문자열)이다.
- 본 SPEC의 모임 생성자(host)는 등록 사용자다(게스트 host는 비범위 — 게스트는 MOIM-002의 초대 수락자에 한정).
- 모임 메타데이터는 `name` 최소 컬럼만 둔다(설명/이미지/카테고리는 비범위).

## 4. 요구사항 (EARS Requirements)

요구사항 모듈: 2개 (모듈 ≤ 5 한도 준수). 각 REQ는 단일 행위를 기술하며, 커버하는 AC ID를 함께 표기한다.

### 모듈 A — 인증 및 인가

#### REQ-MOIM-001 [Ubiquitous] — 인증 요구
시스템은 모든 모임 라우트(생성·단건 조회·목록 조회·멤버 목록 조회·삭제·탈퇴)에 대해, 검증된 사용자 신원이 없는 요청을 처리 없이 거부하고 401을 반환한다(shall). — AC: AC-3

#### REQ-MOIM-002 [State-driven] — 비멤버 조회 차단
**While** 요청자가 대상 모임의 멤버가 아닌 동안, 시스템은 멤버 한정 조회(단건 모임 조회, 멤버 목록 조회)에 대해 403을 반환한다(shall). — AC: AC-2

#### REQ-MOIM-003 [State-driven] — owner 전용 삭제
**While** 요청자가 대상 모임의 owner가 아닌 동안, 시스템은 모임 삭제 요청에 대해 403을 반환한다(shall). — AC: AC-7

### 모듈 B — 모임 라이프사이클 및 멤버십

#### REQ-MOIM-004 [Event-driven] — 모임 생성 + 생성자 자동 멤버십
**When** 인증된 사용자가 모임을 생성하면, 시스템은 모임과 생성자 owner 멤버십(생성 시 입력된 host nickname 포함)을 하나의 트랜잭션으로 원자적으로 생성한다(shall). — AC: AC-1

#### REQ-MOIM-005 [Event-driven] — 모임 조회 (단건/목록)
**When** 멤버가 단건 모임 또는 자신이 속한 모임 목록을 요청하면, 시스템은 해당 모임 정보를 반환한다(shall). — AC: AC-6

#### REQ-MOIM-006 [Event-driven] — 멤버 목록 조회
**When** 멤버가 모임 멤버 목록을 요청하면, 시스템은 각 멤버의 nickname을 포함한 멤버 목록을 반환한다(shall). — AC: AC-5

#### REQ-MOIM-007 [Event-driven] — 멤버 탈퇴
**When** owner가 아닌 멤버가 탈퇴를 요청하면, 시스템은 해당 멤버십을 삭제한다(shall). — AC: AC-4

#### REQ-MOIM-008 [Unwanted] — owner 탈퇴 금지
**If** owner가 자기 모임의 탈퇴를 시도하면, **then** 시스템은 멤버십을 삭제하지 않고 403을 반환한다(소유권 이양은 비범위이며, owner의 퇴장 경로는 모임 삭제다). — AC: AC-8

## 5. 비범위 (Exclusions — What NOT to Build)

- **가입 경로 일체** — self-join, 초대 링크, 게스트 참여는 전적으로 **SPEC-MOIM-002** 책임. 본 SPEC은 멤버십 데이터와 owner 자동 가입만 다룬다.
- **모임 수정(update)** — 본 SPEC은 생성/조회/삭제만. name 변경 등은 후속.
- **소유권 이양(owner transfer)** — owner는 탈퇴 불가(REQ-MOIM-008), 퇴장은 모임 삭제로만.
- **모임 발견/검색** UI 및 API (discovery/search).
- **초대/승인 워크플로우**, per-member 역할 부여.
- **모임 메타데이터 확장**(설명/이미지/카테고리) — `name`만.
- **웹 모임 관리 화면** — 채팅 UI는 CHAT-001, 모임 관리 화면은 후속.
- **모임 삭제 시 메시지 아카이빙** — `onDelete: Cascade` 채택(R-5). 삭제 자체는 REQ-MOIM-003이 규정.

## 6. 변경 마커 (Delta Markers — Brownfield)

- [MODIFY] `apps/backend/prisma/schema.prisma` — `Moim`, `MoimMember` 모델 추가
- [MODIFY] `apps/backend/src/app.module.ts` — `MoimModule` import (ProfileModule 뒤)
- [NEW] `apps/backend/prisma/migrations/<ts>_add_moim/` — 마이그레이션
- [NEW] `apps/backend/src/moim/**` — module/service/controller/dto + 멤버십 인가 헬퍼
- [REGEN] `apps/backend/openapi.json` + `packages/api-client/src/schema.d.ts`

## 7. 의존성 (Dependencies)

- 선행 SPEC: 없음 (체인 최상단).
- 기존 자산: 검증된 신원 추출 가드, `@CurrentUser()`, `PrismaService`, api-client 생성 파이프라인(`backend:openapi` → `api-client:generate`). 구체 식별자는 plan.md.
- 외부 셋업: 없음.

## 8. 품질 게이트 (Quality Gate)

- 백엔드: jest TDD, statement 커버리지 85%+ (TRUST 5).
- `nx run backend:typecheck` + `pnpm --filter @moyura/backend test` 통과.
- 마이그레이션 로컬(`:54322`) 적용 성공.
