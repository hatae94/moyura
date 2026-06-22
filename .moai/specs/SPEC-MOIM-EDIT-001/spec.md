---
id: SPEC-MOIM-EDIT-001
version: 0.1.0
status: draft
created: 2026-06-23
updated: 2026-06-23
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-EDIT-001: 모임 정보 수정 — owner 전용 (이름·일정·장소)

> **DRAFT (자율 야간 루프 C5 기획).** 사용자 리뷰 대기. **백엔드 신규 엔드포인트 + 디바이스 검증 필요** —
> 자율 모드에서 구현하지 않았다(기획만). 깨어난 뒤 검토 → 승인 시 `/moai run SPEC-MOIM-EDIT-001`.

## HISTORY

- 2026-06-23 (v0.1.0): 최초 draft (자율 루프 기획). SPEC-MOIM-004(모임 생성 UI + 일정/장소 필드, completed)의 자연스러운 후속 — 생성은 되지만 **만든 뒤 정보를 고칠 길이 없다**. 백엔드는 `POST /moims`(생성)·`DELETE /moims/:id`(삭제)·`DELETE /moims/:id/membership`(나가기)·`setStartsAt`/`setLocation`(poll finalize 내부 전용)만 있고 **owner 가 모임 이름/일정/장소를 직접 수정하는 엔드포인트(PATCH /moims/:id)는 없다**(2026-06-23 코드 확인). 본 SPEC 은 그 갭을 채운다.

## 1. 개요

owner 가 모임 상세에서 모임 **이름·일정(startsAt)·장소(location)** 를 수정할 수 있게 한다. 생성(MOIM-004)과 대칭이며, 백엔드에 owner 전용 `PATCH /moims/:id` 를 신규 추가하고 웹에 수정 폼을 더한다(모바일은 WebView 호스팅 — 신규 네이티브 0).

## 2. EARS 요구사항 (초안)

- **REQ-EDIT-001** (Event-driven, 백엔드): **WHEN** owner 가 `PATCH /moims/:id` 로 부분 수정(name?/startsAt?/location?)을 보내면, **the backend shall** assertOwner 통과 후 해당 필드만 갱신한다(부분 업데이트, 미전송 필드 보존). 비-owner → 403, 미존재 → 404, startsAt 무효 ISO → 400(POST /moims 검증 정책 미러).
- **REQ-EDIT-002** (Ubiquitous, 쓰기 단일 출처): **The backend shall** startsAt/location 쓰기를 기존 `setStartsAt`/`setLocation` 단일 출처(@MX:ANCHOR 패턴)와 일관되게 처리한다(직접 prisma.moim.update 분산 금지 — name 포함 단일 update 메서드 권장).
- **REQ-EDIT-003** (State-driven, 웹 UI): **WHILE** owner 가 모임 상세(`(main)/home/[id]`)를 보는 동안, **the web app shall** "모임 수정" 어포던스(owner 전용)를 노출하고, 수정 폼(이름/일정 datetime-local/장소)을 moims/new 생성 폼과 일관된 디자인(Meetup 오렌지)으로 제공한다. 비-owner 미노출.
- **REQ-EDIT-004** (Event-driven, 저장): **WHEN** owner 가 저장하면, **the web app shall** Server Action → 구체-경로 헬퍼(`lib/moim/api.ts` 또는 신규)로 `PATCH /moims/:id` 호출 → revalidatePath 로 상세 갱신 + 피드백. 빈 이름 → 오류, 백엔드 실패 → 일반화된 오류(토큰/상세 비노출).
- **REQ-EDIT-005** (Ubiquitous, 회귀): **The web/mobile shall** 기존 상세 렌더(멤버·채팅·투표·초대)·생성·삭제·나가기 흐름을 보존한다. 모바일 "마이"/홈 탭 WebView 가 수정 폼을 그대로 호스팅(신규 네이티브 0).
- **REQ-EDIT-006** (api-client): **The api-client shall** OpenAPI 변경 반영해 `schema.d.ts` 재생성 + `patchMoim`/`UpdateMoimRequest` 타입(또는 web 로컬 구체-경로 헬퍼). path-param 라우트라 web `lib/moim/*` 헬퍼 패턴(polls/invites 미러) 가능.

## 3. 구현 (Delta — 기획)

- **[ADD] backend**: `MoimController` `@Patch(':id')` + `MoimService.updateMoim(sub, id, { name?, startsAt?, location? })`(assertOwner → 부분 update). DTO `UpdateMoimDto`(@ApiProperty optional name/startsAt/location, no class-validator — POST /moims 패턴 미러, startsAt ISO 무효 400 명시 체크). jest: owner 부분수정/비-owner 403/미존재 404/무효 startsAt 400/미전송 보존.
- **[ADD/MODIFY] web**: 모임 상세에 owner 전용 "모임 수정" 진입(버튼/링크) + 수정 폼(`(main)/home/[id]/edit` 또는 인라인 섹션) + Server Action + 구체-경로 헬퍼(`patchMoim`). moims/new 폼 재사용/미러.
- **[ADD] api-client**: schema 재생성 + patchMoim 헬퍼/타입.

## 4. 제외

- 모임 삭제/나가기 UI(백엔드는 이미 존재 — 별도 SPEC 후보), owner 양도, 멤버 추방, 모임 공개/비공개 설정, 이미지/커버는 범위 밖. MVP = 이름·일정·장소 수정.

## 5. 검증 게이트 (기획)

- backend jest(신규 수정 케이스 + 회귀) GREEN, tsc 0(all), web lint/build 0, mobile vitest 회귀 0.
- **디바이스 종단(device-gated)**: iOS WebView 에서 owner 모임 수정 → 저장 → 상세/홈 카드 일정·장소·이름 갱신 실관찰. (자율 모드에서 미검증 — 구현·검증은 사용자 승인 후.)

## 6. 자율 루프 메모

- 본 SPEC 은 **백엔드 신규 엔드포인트(PATCH /moims/:id)** 가 필요해 자율 모드 제약(백엔드 변경은 DB 통합테스트 불가 — Supabase 중지)상 **구현하지 않고 기획만** 남긴다. 깨어난 뒤 `/moai run` 으로 진행 권장. 백엔드 단위 jest 는 DB 없이 mock 으로 가능하나, 통합/라이브 검증은 Supabase 재기동 + 디바이스 필요.
