---
id: SPEC-MOIM-004
version: 0.2.0
status: in-progress
created: 2026-06-18
updated: 2026-06-19
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-004: 모임 생성 UI 기능화 + 이벤트 일정/장소 필드

## HISTORY

- 2026-06-19 (v0.2.0): 구현 완료 및 라이브 검증(커밋 3145ad1). 백엔드: `Moim.startsAt DateTime?` + `location String?` additive 마이그레이션(`20260619000000_add_moim_event_fields`) 적용, `CreateMoimDto`/`MoimResponseDto` 두 필드 반영, `POST /moims`에 optional 영속 + startsAt 무효 400, `GET /moims`·`GET /moims/:id` 응답에 두 필드 포함. api-client: `createMoim()` 편의 메서드 + `CreateMoimRequest` 별칭 추가. 웹(Meetup 오렌지 디자인): `app/moims/new` 생성 페이지(Server Component + `createMoimAction` Server Action + `useActionState` 폼 — 이름/호스트 표시 이름/일정/장소) → `POST /moims` → `/home/{id}` redirect; 홈 "새 모임 만들기" CTA → `/moims/new` Link(비기능 placeholder 대체); `HomeTab` 카드 + `/home/[id]` 상세에 일정/장소 정직 표시(null → "일정 미정"/장소 생략, 허위 값 없음). 라이브 검증(2026-06-19): 데스크톱 브라우저 + 실 세션 — 폼 제출(이름 "주말 등산 모임", 닉네임 "등산대장", 일정 2026-06-27 09:30, 장소 "북한산 우이역 집결") → 모임 startsAt+location 영속 → `/home/{id}` 이동 → 일정(📅 2026년 6월 27일 오전 9:30) + 장소(📍 북한산 우이역 집결) 렌더 확인. 백엔드 직접 POST로 두 필드 반환 확인, 무효 startsAt → 400 확인. 자동 게이트: backend jest 222/222, tsc 0(backend/web/api-client/mobile), web lint/build 0, mobile vitest 215/215(회귀 0), prisma migrate clean. **AC-1~5 라이브 검증 PASS, AC-6 게이트 통과.** 미완료 device-gated 항목: 모바일 WebView 셸에서 `createMoimAction` server-action redirect → `/home/{id}` 로드 시 기존 `detailRouteForUrl` push가 트리거되는지(SPEC-MOIM-003 계약 — server-action redirect 경로는 신규 트리거) iOS 시뮬레이터 검증 대기. 이 항목 완료 시 `completed` 전환. 참고: 초기 검증 시 stale 장기 실행 백엔드 프로세스(포트 3001 EADDRINUSE)가 이전 코드를 서빙해 "필드 미영속" 오증상이 발생했으나, 프로세스 재시작 후 정상 동작 확인 — 코드 결함 아님, 로컬 dev-env 프로세스 아티팩트.
- 2026-06-18 (v0.1.0): 최초 draft. SPEC-MOIM-003(spec.md:122 "Moim 스키마 필드 확장 — 별도 후속 SPEC", :124 "모임 생성 기능 배선 — 본 SPEC 범위 아님")이 명시적으로 카브아웃한 두 항목을 **이번 SPEC에서 함께** 다룬다 — 단, 일정(date/time) + 장소(location)에 **한정**한다. 제품 방향(product.md MVP + 로그인 태그라인 "일정, 장소, 투표를 한곳에서")이 모임을 when/where/vote 를 갖는 실 이벤트로 가리키나, **투표(투표/poll)는 본 SPEC에서 명시적으로 제외**한다(별도·대형 후속 SPEC — poll 엔티티 + options + per-user votes + 결과 UI 가 필요). 핵심 결정: (1) 백엔드 — `Moim` 에 **additive nullable** `startsAt DateTime?` + `location String?` 추가(기존 모임은 null, 무중단 마이그레이션); `CreateMoimDto` 에 optional `startsAt`/`location` 추가, 생성 엔드포인트가 영속(no-ValidationPipe 패턴 보존 — name/nickname 비어 있음만 400, startsAt 는 존재 시 ISO 유효성 최소 검증); `GET /moims`·`GET /moims/:id` 응답에 두 필드 포함. (2) api-client — `createMoim()` 편의 메서드 추가(`POST /moims`, 기존 `listMoims`/`patchMe` 패턴), `schema.d.ts` 재생성. (3) **웹 생성 UI 기능화** — 홈 "새 모임 만들기" 비기능 CTA(SPEC-MOIM-003 Exclusions "실 모임 생성 없음")를 실제 생성 플로우로 전환(생성 페이지 + 폼: 이름/호스트 표시 이름/일정/장소) → `POST /moims` → 새 모임 상세 `/home/{id}` 로 이동. (4) 표시 — 홈 카드 + 상세에 일정/장소를 **정직하게** 표시(null → "일정 미정"/생략, 허위 값 금지). (5) 가드 — 생성 페이지는 기존 `moims` 그룹(`moims/layout.tsx` 의 `requireNamedSession()`, SPEC-WEB-GUARD-001)을 상속해 보호 라우트 일관, 모바일에서는 in-WebView 처리(생성 경로는 앱 라우트 아님 → 네이티브 라우트 무변경). **스코프 결정 기록**: (a) 생성 페이지 위치를 `app/moims/new` 로 둔다 — 원 요청의 "app/(main)/moims/new" 는 `(main)` 그룹 밖의 기존 `moims` 그룹(이미 가드 보유)으로 해석하는 것이 최소·일관(채팅 페이지 `moims/[id]/chat` 와 동일 그룹); (b) 모바일 네이티브 라우트 무변경 — `moims/*` 는 `APP_ROUTES` 에 없어 in-WebView 로 로드되므로 생성 페이지 자체는 네이티브 push 불필요(생성 후 이동 대상 `/home/{id}` 는 SPEC-MOIM-003 의 기존 detail-push 가 이미 처리); (c) 디자인은 Meetup 오렌지 시맨틱 토큰(`(main)/home/[id]` 및 `(main)/*` 와 동일 — login/onboarding 의 blue 흐름 아님, 확정된 디자인 결정).

---

## 1. 개요 (Overview)

모임을 "이름만 있는 그룹"에서 **일정과 장소를 가진 실 이벤트**로 한 걸음 진전시킨다. 두 가지를 함께 다룬다:

1. **이벤트 필드 추가** — `Moim` 에 일정(`startsAt`)과 장소(`location`)를 additive nullable 필드로 추가하고, 생성 시 입력·영속하며, 목록/상세에서 표시한다.
2. **모임 생성 UI 기능화** — 현재 비기능 placeholder 인 홈의 "새 모임 만들기" CTA(SPEC-MOIM-003 에서 명시적으로 제외됨)를 실제 생성 플로우로 만든다. 모임은 지금까지 `POST /moims`(API, SPEC-MOIM-001)로만 생성 가능했고 웹 UI 진입점이 없었다 — 일정/장소를 **입력받으려면** 생성 폼이 필요하므로, 본 SPEC은 "생성 기능화"와 "일정/장소 추가"를 한 단위로 묶는다.

아키텍처는 하이브리드(불변)다: 웹이 화면 콘텐츠를 소유(Next.js 16 App Router + Tailwind v4 + lucide-react)하고, 모바일이 네이티브 내비게이션 크롬을 소유(expo-router)한다. 생성 페이지는 모바일 WebView 셸 안에서 in-WebView 로 렌더되고(생성 경로는 앱 라우트가 아니므로 네이티브 push 불필요), 데스크톱은 직접 렌더한다. 생성 완료 후 이동하는 새 모임 상세(`/home/{id}`)는 SPEC-MOIM-003 의 기존 detail-push 계약이 그대로 처리한다.

이는 **additive 스키마 2필드 + 생성 폼 1개 + 표시 배선**이지 대형 기능이 아니다. 투표(poll)는 본 SPEC에 포함하지 않는다.

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 6개로 제한한다. 각 모듈은 `REQ-MOIM4-XXX`로 번호를 부여하며(기존 SPEC-MOIM-001 `REQ-MOIM-XXX`·SPEC-MOIM-003 `REQ-MOIM3-XXX` 와 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOIM4-001: Moim 이벤트 필드 확장 (Ubiquitous)

- **The backend shall** `Moim` 모델에 두 개의 **additive nullable** 필드를 추가한다: `startsAt DateTime?`(이벤트 일정 — 날짜·시각) 및 `location String?`(자유 텍스트 장소, 예: "강남역 스타벅스").
- **The backend shall** 이 추가를 **무중단(additive) 마이그레이션**으로 적용한다 — 기존 모임 row 는 두 필드 모두 `null` 이 되며, 기존 동작(생성·목록·상세·멤버·채팅·초대)은 어떤 회귀도 없이 보존된다.
- **The backend shall** `Moim` 의 기존 필드(`id`/`name`/`createdBy`/`createdAt`)와 관계(members/invites/messages)를 변경하지 않는다.

### REQ-MOIM4-002: 생성 엔드포인트 — 이벤트 필드 영속 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 인증 사용자가 optional `startsAt`/`location` 을 포함해 `POST /moims` 를 호출하면, **the backend shall** 두 필드를 모임에 영속하고, 생성자 owner 멤버십(`role=owner`) 생성을 포함한 기존 트랜잭션 동작(SPEC-MOIM-001 `createMoim`)을 변경 없이 유지한다.
- (Event-driven) **WHEN** `startsAt`/`location` 이 요청에 없거나 비어 있으면, **the backend shall** 해당 필드를 `null` 로 저장하고 모임 생성을 정상 수행한다(두 필드는 optional — 일정/장소 없는 모임도 유효).
- (Unwanted behavior) **IF** `name` 또는 `nickname` 이 (trim 후) 비어 있으면, **then the backend shall** 기존과 동일하게 `400 Bad Request` 를 반환한다(no-ValidationPipe 패턴 보존 — 컨트롤러의 명시적 `requireNonEmpty` 검사 유지).
- (Unwanted behavior) **IF** `startsAt` 이 제공되었으나 유효한 ISO-8601 날짜로 파싱되지 않으면, **then the backend shall** `400 Bad Request` 를 반환한다(존재 시에만 최소 형식 검증 — 부재/빈 값은 검증 대상 아님).

### REQ-MOIM4-003: 조회 응답 — 이벤트 필드 포함 (Ubiquitous)

- **The `GET /moims`(목록) response shall** 각 모임에 대해 `startsAt`(ISO-8601 문자열 또는 `null`)과 `location`(문자열 또는 `null`)을 포함한다.
- **The `GET /moims/:id`(상세) response shall** `startsAt`(ISO-8601 문자열 또는 `null`)과 `location`(문자열 또는 `null`)을 포함한다.
- **The backend shall** 기존 멤버 스코핑(목록=자신이 속한 모임만, 상세=비멤버 403·미존재 404)을 어떤 약화도 없이 보존한다(`MoimService` 인가 단일 출처 불변).

### REQ-MOIM4-004: api-client 모임 생성 표면 (Ubiquitous)

- **The api-client shall** `POST /moims`(모임 생성)를 위한 타입드 편의 메서드 `createMoim()` 를 노출한다 — 기존 `listMoims`/`getMe`/`patchMe` 패턴과 일관(경로 키 `/moims` 는 리터럴이라 generic `request` 로 타입 안전).
- **The api-client shall** `createMoim()` 의 요청 바디로 `name`/`nickname`(필수) + `startsAt`/`location`(optional)을 받아 `MoimResponse`(생성된 모임)를 반환한다.
- **The api-client shall** 토큰을 URL/query 가 아닌 Authorization Bearer 헤더로만 전달한다(기존 `TokenProvider`/R-A9 보존).
- **The api-client shall** OpenAPI 생성 `schema.d.ts` 재생성으로 `MoimResponse`/`CreateMoimDto` 타입에 `startsAt`/`location` 이 반영되도록 한다.

### REQ-MOIM4-005: 기능형 모임 생성 UI (Event-driven / State-driven 혼합)

- (Event-driven) **WHEN** 인증 사용자가 홈 탭의 "새 모임 만들기" CTA 를 트리거하면, **the web app shall** 기능형 생성 폼(`/moims/new`)으로 이동한다(기존 비기능 placeholder 동작 대체).
- (Ubiquitous) **The create form shall** 입력 필드를 제공한다: 모임 이름(`name`, 필수), 호스트 표시 이름(`nickname`, 필수), 일정(`startsAt`, optional — `<input type="datetime-local">`), 장소(`location`, optional — 자유 텍스트).
- (Event-driven) **WHEN** 사용자가 유효한 폼(최소 `name` + `nickname`)을 제출하면, **the web app shall** 세션 토큰으로 `POST /moims`(api-client `createMoim`)를 호출해 실제 모임을 생성하고, 성공 시 새 모임 상세 `/home/{id}` 로 이동한다.
- (Unwanted behavior) **IF** `name`/`nickname` 이 비어 있거나 백엔드가 오류(400 등)를 반환하면, **then the web app shall** 생성 폼에 머무른 채 일반화된 오류를 표시하고(토큰/오류 상세 비노출) 사용자가 재제출할 수 있게 한다.
- (State-driven) **WHILE** 미인증/이름 미보유 사용자가 생성 페이지(`/moims/new`)에 접근하는 동안, **the web app shall** 기존 `moims` 그룹 가드(`requireNamedSession()` — 미인증 → `/login`, 이름 미보유 → `/onboarding`, SPEC-WEB-GUARD-001)를 상속해 보호한다.

### REQ-MOIM4-006: 일정/장소 정직 표시 (State-driven / Ubiquitous 혼합)

- (State-driven) **WHILE** 모임의 `startsAt` 이 존재하는 동안, **the web app shall** 홈 카드와 상세 화면에 일정을 한국어로 포맷해 표시한다; **WHILE** `startsAt` 이 `null` 인 동안, **the web app shall** "일정 미정" 으로 표시한다(허위 값 금지).
- (State-driven) **WHILE** 모임의 `location` 이 존재하는 동안, **the web app shall** 홈 카드와 상세 화면에 장소를 표시한다; **WHILE** `location` 이 `null` 인 동안, **the web app shall** 장소 라인을 생략한다(빈 값/허위 값 금지).
- (Ubiquitous) **The web app shall** 생성 폼·홈 카드·상세 화면을 Meetup 디자인 시스템(`(main)/home/[id]` 및 `(main)/*` 가 쓰는 동일 오렌지 시맨틱 토큰 — `bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`)으로 렌더하며, login/onboarding 의 blue 흐름 토큰을 사용하지 않는다.

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 기존 코드를 수정하는 brownfield 작업이다. 파일·라인은 작성 시점(2026-06-18) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/src/moim/moim.service.ts` `createMoim`(:20, @MX:ANCHOR) — moim + owner 멤버십 원자 트랜잭션. **트랜잭션 구조 보존**, `tx.moim.create({ data })` 에 `startsAt`/`location` 만 additive 로 전달(아래 [MODIFY]).
- `apps/backend/src/moim/moim.service.ts` `assertMember`/`assertOwner`/`getMoim`/`listMyMoims`/`listMembers`(:43~89) — 인가·조회 로직. 변경 없음(추가 필드는 select * 로 자동 포함).
- `apps/web/app/(main)/layout.tsx` / `apps/web/app/moims/layout.tsx` — `requireNamedSession()` 가드. 변경 없음, 상속만(`/moims/new` 가 `moims` 그룹 하위이므로 자동 적용).
- `apps/web/lib/auth/require-named-session.ts` — 가드 정책 본체. 변경 없음, 재사용만.
- `apps/web/app/onboarding/{actions.ts,onboarding-form.tsx}` — Server Action + `useActionState` 클라이언트 폼 패턴의 참조 원본(생성 폼이 동일 패턴을 따른다). 변경 없음. **단, 디자인 토큰은 미러하지 않는다** — onboarding 은 blue, 생성 폼은 Meetup 오렌지(REQ-MOIM4-006).
- `apps/web/app/(main)/home/[id]/page.tsx` — 모임 상세 페이지(SPEC-MOIM-003). 일정/장소 표시 추가(아래 [MODIFY]). 멤버/채팅/가드 동작 보존.
- `apps/mobile/lib/route-map-core.ts` / `apps/mobile/hooks/auth-bridge-core.ts` — 네이티브 라우트 매핑·디스패치. **모바일 무변경** — `moims/*` 는 `APP_ROUTES` 에 없어 in-WebView 로 로드되고(생성 페이지), 생성 후 이동 대상 `/home/{id}` 는 기존 `detailRouteForUrl` push 가 이미 처리(SPEC-MOIM-003 계약).
- `apps/backend/src/moim/moim.controller.ts` `requireNonEmpty`(:136) — name/nickname 비어 있음 400 검사. 보존(startsAt/location 은 별도 optional 처리).

### [MODIFY] (수정)

- `apps/backend/prisma/schema.prisma` `Moim`(:36) — `startsAt DateTime?` + `location String?` 추가(additive nullable). 마이그레이션 생성.
- `apps/backend/src/moim/dto/create-moim.dto.ts` — optional `startsAt?: string`(ISO-8601) + `location?: string` 추가(`@ApiProperty({ required: false })`). class-validator 미사용 정책 유지.
- `apps/backend/src/moim/dto/moim-response.dto.ts` — `startsAt: string | null` + `location: string | null` 추가(`@ApiProperty`).
- `apps/backend/src/moim/moim.controller.ts` `create`(:49) — body 의 optional `startsAt`/`location` 을 읽어 service 에 전달. `startsAt` 존재 시 ISO 유효성 최소 검증(파싱 실패 400). `toMoimDto`(:144) 가 두 필드를 직렬화(`startsAt?.toISOString() ?? null`, `location ?? null`).
- `apps/backend/src/moim/moim.service.ts` `createMoim` 시그니처 — `startsAt`/`location` optional 인자 추가, `tx.moim.create({ data })` 에 전달(트랜잭션 구조 불변).
- `apps/web/app/(main)/home/HomeTab.tsx` — `CreateMeetupButton` 을 `/moims/new` 로 이동하는 `<Link>` 로 전환(비기능 button 대체). `MeetupCard` 에 일정(`startsAt` 포맷 또는 "일정 미정") + 장소(`location` 존재 시) 표시 추가(§5 정직 degrade). 기존 레이아웃 셸 보존.
- `apps/web/app/(main)/home/[id]/page.tsx` — 상세 헤더에 일정(`startsAt`/"일정 미정") + 장소(`location` 존재 시) 표시 추가. 멤버/채팅 섹션 보존.
- `apps/web/lib/moim/api.ts` `MoimDetail` 인터페이스 — `startsAt: string | null` + `location: string | null` 추가(상세 표시용). `getMoim`/`getMoimMembers` 호출 패턴 보존.
- `packages/api-client/src/index.ts` — `createMoim()` 편의 메서드 추가(`POST /moims`, body 직렬화 — `patchMe` 패턴). `CreateMoimRequest` 타입 별칭 추가. `MoimResponse`(기존 별칭)는 재생성된 `schema.d.ts` 로 `startsAt`/`location` 자동 포함.
- `packages/api-client/src/schema.d.ts` — `nx run api-client:generate` 재생성(백엔드 OpenAPI 변경 반영 — `CreateMoimDto`/`MoimResponseDto` 에 두 필드). 수동 편집 없음.

### [NEW] (신규)

- `apps/web/app/moims/new/page.tsx` — 생성 페이지(Server Component 권장 — 세션 access_token 도출 후 클라이언트 폼에 전달). `moims` 그룹 가드 상속.
- `apps/web/app/moims/new/create-moim-form.tsx` — 생성 폼(Client Component, `useActionState`). 입력: 이름/호스트 표시 이름/일정(datetime-local)/장소. Meetup 오렌지 디자인 토큰(REQ-MOIM4-006).
- `apps/web/app/moims/new/actions.ts` — `createMoimAction` Server Action(`onboarding/actions.ts` 패턴). FormData 읽기 → 세션 → api-client `createMoim` → 성공 시 `redirect("/home/{id}")`, 실패 시 폼 머무름 + 일반화 오류.

### [REMOVE]

- 없음(기존 경로 보존; CTA 는 비기능 button → 기능형 Link 로 전환되며 파일 삭제 없음).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **투표(poll/투표) 기능** — 본 SPEC의 가장 중요한 제외 항목. poll 엔티티 + options + per-user votes + 결과 집계 UI 가 필요한 별도·대형 후속 SPEC이다. 로그인 태그라인의 "투표"는 본 SPEC 범위 밖이며, `Moim` 에 vote/poll 관련 필드나 테이블을 추가하지 않는다.
- **지도 / 지오코딩 / 좌표** — `location` 은 자유 텍스트 1개 필드일 뿐이다. 지도 임베드·주소 검색·위경도 저장·장소 자동완성 일절 없음.
- **기존 모임 수정 UI(edit)** — 생성된 모임의 일정/장소/이름을 사후 편집하는 화면은 범위 밖(향후 SPEC). 본 SPEC은 생성 시점의 입력만 다룬다.
- **RSVP / 참석 응답 / 출석** — 일정이 생겨도 참석 의사 표시·정원·대기열 등은 다루지 않는다(향후 SPEC).
- **반복 일정 / 종료 시각(endsAt) / 종일 이벤트** — 단일 시작 시각(`startsAt`)만 다룬다. 종료 시각·반복·타임존 정규화는 범위 밖(향후 가능).
- **채팅 / 초대 / 멤버 동작 변경** — SPEC-CHAT-001/MOIM-002/MOIM-001 의 기존 채팅·초대·멤버십 동작을 변경하지 않는다(상세 화면의 "채팅 입장" 링크·멤버 목록 보존).
- **백엔드 인가/가드 정책 변경** — 멤버 스코핑(목록·상세 403/404)·라우트 가드(401)를 약화하거나 변경하지 않는다. 추가 필드는 인가에 영향 없다.
- **모바일 네이티브 라우트 추가** — 생성 페이지는 in-WebView(`moims/*` 비-앱-라우트)로 처리되므로 expo-router 네이티브 라우트나 detail-push 분류를 추가하지 않는다(SPEC-MOIM-003 계약 재사용).
- **`startsAt` 의 풍부한 검증/표준화** — 존재 시 ISO-8601 파싱 가능 여부만 최소 검증한다. 과거 날짜 거부·타임존 변환·업무 규칙(예: "미래만 허용")은 범위 밖.

---

## 5. 설계 노트 (Design Notes)

### 생성 페이지 위치 — `app/moims/new` (스코프 결정)

- 원 요청은 "app/(main)/moims/new 또는 폼"을 제시했으나, `(main)` 그룹 하위에 `moims` 디렉터리는 없다 — 기존에는 **별도 top-level `moims` 그룹**(`app/moims/`, 자체 `layout.tsx` 의 `requireNamedSession()` 가드, SPEC-WEB-GUARD-001)이 `moims/[id]/chat` 을 호스팅한다.
- **결정(최소·일관)**: 생성 페이지를 `app/moims/new/` 에 둔다 — 이미 가드를 가진 `moims` 그룹을 상속(별도 가드 파일 불필요)하고, 채팅 페이지와 같은 그룹에 모임 관련 라우트가 모이며, 모바일에서 `moims/*` 가 비-앱-라우트라 in-WebView 로 자연스럽게 로드된다(네이티브 라우트 churn 0).
- 대안 `app/(main)/home/new` 는 기각: 모바일 `detailRouteForUrl` 이 `/home/new` 를 detail-push(부모 home + id="new")로 오분류해 `(tabs)/home/new` 로 네이티브 push 를 시도하고, `[id]` 동적 라우트가 "new"를 모임 id 로 취급할 수 있어 의미가 오염된다.

### 생성 후 이동 — `/home/{id}` (기존 detail-push 재사용)

- 생성 성공 시 `createMoimAction` 이 `redirect("/home/{새 id}")` 한다. 데스크톱은 일반 Next 라우팅, 모바일은 SPEC-MOIM-003 의 기존 `detailRouteForUrl` 이 `/home/{id}` 를 네이티브 `(tabs)/home/[id]` push 로 처리한다 — 본 SPEC은 그 경로를 변경하지 않는다.
- 단, `redirect` 는 데스크톱 in-WebView 가 아닌 server-action 컨텍스트에서 일어난다. 모바일 셸에서 server-action redirect 후 `/home/{id}` 로드 시 네이티브 push 가 트리거되는지는 디바이스 검증 항목이다(§7).

### 생성 폼 (Client + Server Action)

- `onboarding-form.tsx` + `onboarding/actions.ts` 의 `useActionState` + Server Action 패턴을 **구조적으로** 미러한다(빈 값/백엔드 오류 → 폼 머무름 + 일반화 오류, 성공 → redirect). **디자인 토큰은 미러하지 않는다** — onboarding 은 blue 인증 흐름, 생성 폼은 Meetup 오렌지(REQ-MOIM4-006).
- 일정 입력은 `<input type="datetime-local">` 로 충분하다. 제출 시 datetime-local 값(로컬 시각, 타임존 없음)을 ISO-8601 로 변환해 백엔드에 전달한다(빈 값이면 미전송 → null). 타임존 정규화는 범위 밖(§4) — 단순 `new Date(value).toISOString()` 로 충분(MVP).
- 장소는 자유 텍스트 `<input type="text">`. 빈 값이면 미전송 → null.

### 백엔드 optional 필드 처리 (no-ValidationPipe 보존)

- 이 프로젝트는 `ValidationPipe` 가 없다(C-1). 컨트롤러가 `name`/`nickname` 비어 있음을 명시적으로 400 처리하는 기존 패턴을 유지한다.
- `startsAt`: 존재(non-empty)하면 `new Date(value)` 파싱 → `isNaN(date.getTime())` 이면 400(`BadRequestException`), 유효하면 `Date` 로 영속. 부재/빈 문자열 → `null`.
- `location`: 존재하면 trim 후 영속, 빈 값 → `null`(자유 텍스트 — 형식 검증 없음).
- `toMoimDto` 직렬화: `startsAt: moim.startsAt ? moim.startsAt.toISOString() : null`, `location: moim.location ?? null`.

### 홈 카드 / 상세 정직 표시 (SPEC-MOIM-003 §5 degrade 연장)

- SPEC-MOIM-003 은 데이터 출처 없는 mock 필드(시간/장소/상태)를 카드에서 **제거**했다. 본 SPEC은 이제 일정/장소가 실 데이터 출처를 가지므로 **정직하게 복원**한다: `startsAt` 있으면 포맷 표시 / 없으면 "일정 미정"(또는 미표시), `location` 있으면 표시 / 없으면 생략. 허위/플레이스홀더 값은 금지(REQ-MOIM4-006).
- 기존 "개설일"(`createdAt`) 표시는 보존하거나 일정 표시와 함께 정리(최소 churn 쪽 — 구현 단계 판단). 상태 배지/멤버 수는 여전히 출처 없음 → 미표시 유지(MOIM-003 Exclusions 연속).

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| 마이그레이션 비-additive 회귀 | MEDIUM | 신규 필드가 nullable 가 아니거나 default 없이 추가되면 기존 row 가 깨진다. 두 필드 모두 `?`(nullable) 로 추가하고 `prisma migrate` clean 을 게이트로 확인. |
| server-action redirect → 모바일 네이티브 push 누수 | MEDIUM | 생성 성공 redirect(`/home/{id}`) 가 모바일 셸에서 네이티브 push 로 이어지는지(또는 in-WebView 로 떨어지는지) 디바이스 검증 필요. push 분류는 SPEC-MOIM-003 의 `decideWebViewLoad` 가 담당하나 server-action redirect 경로는 신규 트리거. |
| datetime-local 타임존 모호성 | LOW | datetime-local 은 타임존 없는 로컬 시각. `new Date(value).toISOString()` 가 브라우저 로컬 타임존으로 해석된다 — MVP 허용(단일 사용자·단일 타임존 가정). 타임존 정규화는 §4 제외. |
| no-ValidationPipe 우회 입력 | LOW | startsAt 형식 검증을 컨트롤러에서 명시적으로 하지 않으면 잘못된 문자열이 DB 에 들어갈 수 있다. 존재 시 ISO 파싱 400 검증으로 차단. location 은 자유 텍스트라 검증 불필요. |
| 디자인 토큰 혼선(blue vs orange) | LOW | onboarding 폼을 참조하다 blue 토큰을 복사할 위험. REQ-MOIM4-006 으로 Meetup 오렌지 토큰 강제, 코드 리뷰에서 확인. |
| api-client request 템플릿 미치환 | LOW | `createMoim` 은 리터럴 경로 `/moims`(POST)이므로 템플릿 치환 불필요 — `listMoims`/`patchMe` 와 동일하게 generic request 로 타입 안전. 상세 표시 필드는 `lib/moim/api.ts` 의 기존 구체-경로 패턴 보존. |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 라이브 iOS 시뮬레이터 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다. 백엔드는 jest(신규 케이스 포함), api-client 는 tsc. 모바일은 본 SPEC에서 무변경(검증은 회귀 0 확인용 tsc/vitest).

- `prisma migrate` clean (additive nullable 마이그레이션, 기존 row null)
- backend jest 통과 (신규: 일정/장소 포함 생성 + 미포함 생성 + 조회 응답 필드 + startsAt 무효 400 + name/nickname 누락 400 보존)
- `tsc` 통과 (0 error — backend + web + api-client)
- web lint 통과 (0 error)
- `nx run web:build` 통과 (0 error — `/moims/new` 라우트 등록)
- mobile tsc / vitest 통과 (무변경 회귀 0)
- `expo export` 통과 (모바일 셸 회귀 0)
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않는다. iOS 시뮬레이터(또는 실 기기) dev build 에서 홈 "새 모임 만들기" 탭 → 생성 폼(일정/장소 입력) → 제출 → 새 모임 상세(`/home/{id}`, 네이티브 push) 진입 → 홈 카드/상세에 입력한 일정/장소 표시가 라이브 검증되어야 status 가 `completed` 로 전환된다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated). 그 전까지 status 는 `in-progress`.
- 상세 수용 기준은 `acceptance.md` 참조.
