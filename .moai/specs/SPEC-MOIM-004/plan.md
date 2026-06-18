# SPEC-MOIM-004 구현 계획 (Plan)

> SPEC-MOIM-004: 모임 생성 UI 기능화 + 이벤트 일정/장소 필드
> 본 계획은 파일별 작업 단위(milestone)와 기술 접근을 정의한다. 시간 추정은 사용하지 않으며 우선순위·순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

- **방법론**: brownfield. 백엔드는 jest(신규 케이스 추가), 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 검증. 백엔드 변경 → OpenAPI → api-client 재생성 → web 소비의 단방향 데이터 흐름을 따른다.
- **데이터 흐름(순서 의존)**: (1) Prisma 스키마 + 마이그레이션 → (2) DTO + service + controller → (3) `nx run api-client:generate`(재생성) → (4) api-client `createMoim` + 타입 별칭 → (5) web 생성 폼/액션 + 표시. 백엔드가 먼저 OpenAPI 를 바꿔야 api-client 타입이 두 필드를 갖는다.
- **additive 원칙**: 모든 백엔드 변경은 기존 동작을 보존하는 additive 변경이다 — nullable 필드, optional DTO 프로퍼티, 기존 트랜잭션 구조 불변.
- **디자인 시스템**: Meetup 오렌지 시맨틱 토큰(`bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`) — `(main)/home/[id]` 와 `HomeTab` 의 토큰을 따른다. onboarding 의 blue 토큰을 복사하지 않는다.

## 2. 마일스톤 (파일별 작업 단위)

순서는 데이터 흐름 의존성을 따른다(M1 → M5). 우선순위는 모두 본 SPEC 완료에 필수(High).

### M1 — 백엔드 스키마 + 마이그레이션 (Priority: High)

- `apps/backend/prisma/schema.prisma` — `Moim` 모델에 추가:
  - `startsAt DateTime? @map("starts_at")` (이벤트 일정, nullable)
  - `location String?` (자유 텍스트 장소, nullable)
  - 기존 필드/관계(members/invites/messages) 불변.
- 마이그레이션 생성(additive). 기존 row 는 두 컬럼 모두 NULL.
- 게이트: `prisma migrate` status clean, 기존 모임 조회 회귀 0.

### M2 — 백엔드 DTO + service + controller (Priority: High, depends: M1)

- `apps/backend/src/moim/dto/create-moim.dto.ts` — optional `startsAt?: string`(ISO-8601 예시) + `location?: string` 추가(`@ApiProperty({ required: false })`). class-validator 미사용 정책 유지.
- `apps/backend/src/moim/dto/moim-response.dto.ts` — `startsAt: string | null` + `location: string | null` 추가(`@ApiProperty`, nullable 예시).
- `apps/backend/src/moim/moim.service.ts` `createMoim(sub, name, nickname, startsAt?, location?)` — 시그니처에 optional 인자 추가, `tx.moim.create({ data: { name, createdBy: sub, startsAt, location } })` 로 전달. 트랜잭션 구조·owner 멤버십 생성 불변(@MX:ANCHOR 경계 보존).
- `apps/backend/src/moim/moim.controller.ts` `create`:
  - body 에서 optional `startsAt`/`location` 추출.
  - `startsAt` 존재(non-empty) 시 `new Date(value)` 파싱 → `isNaN(getTime())` 이면 `BadRequestException`(400); 부재/빈 값 → undefined(→ null 저장).
  - `location` trim, 빈 값 → undefined(→ null).
  - `name`/`nickname` `requireNonEmpty` 400 검사 보존.
  - `toMoimDto` 에 `startsAt: moim.startsAt ? moim.startsAt.toISOString() : null`, `location: moim.location ?? null` 추가.
- 게이트: tsc 0, OpenAPI 가 두 필드 노출.

### M3 — backend jest (Priority: High, depends: M2)

- `apps/backend/src/moim/moim.controller.spec.ts` — 신규 케이스:
  - startsAt + location 포함 생성 → service 가 인자로 받고 DTO 가 두 필드 반환.
  - startsAt/location 미포함 생성 → service 가 undefined/null, 정상 생성.
  - startsAt 무효 문자열 → 400.
  - name/nickname 누락 → 400 보존(회귀).
- `apps/backend/src/moim/moim.integration.spec.ts` — fake store 에 `startsAt`/`location` 반영, `GET /moims`·`GET /moims/:id` 응답에 두 필드 포함 검증(seed 에 값 있는 모임 + null 모임 혼합). 기존 401/403/404 케이스 회귀 0.
- `apps/backend/src/moim/moim.service.spec.ts` — `createMoim` 이 startsAt/location 을 `tx.moim.create` data 에 전달하는지(있을 때/없을 때) 검증.
- 게이트: backend jest 전체 통과(신규 포함), branch coverage floor 유지.

### M4 — api-client createMoim + 재생성 (Priority: High, depends: M2)

- `nx run api-client:generate` — 백엔드 OpenAPI 변경을 반영해 `packages/api-client/src/schema.d.ts` 재생성(`CreateMoimDto`/`MoimResponseDto` 에 startsAt/location). 수동 편집 금지.
- `packages/api-client/src/index.ts`:
  - `CreateMoimRequest = components['schemas']['CreateMoimDto']` 타입 별칭 추가.
  - `MoimResponse`(기존 별칭) — 재생성으로 두 필드 자동 포함(코드 변경 없음, 주석만 갱신).
  - `createMoim(body: CreateMoimRequest): Promise<MoimResponse>` 편의 메서드 추가 — `request('/moims', 'post', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })` (patchMe 패턴). Bearer 토큰은 getToken 으로 주입(R-A9).
- 게이트: api-client tsc 0.

### M5 — 웹 생성 UI + 표시 (Priority: High, depends: M4)

- `apps/web/app/moims/new/page.tsx` (NEW) — Server Component. `moims` 그룹 가드 상속(+ 명시적 `requireNamedSession()` 으로 access_token 확보). 세션을 `CreateMoimForm` 에 전달(또는 폼이 Server Action 으로 직접 세션 읽기 — onboarding 패턴). Meetup 오렌지 셸.
- `apps/web/app/moims/new/actions.ts` (NEW) — `"use server"` `createMoimAction(prev, formData)`:
  - FormData: `name`/`nickname`(필수, trim) + `startsAt`(datetime-local → ISO 변환, 빈 값 미전송) + `location`(trim, 빈 값 미전송).
  - 빈 name/nickname → `{ error }` 반환(폼 머무름).
  - 세션 없음 → `redirect("/login")`.
  - `createApiClient({ getToken }).createMoim(body)` → 성공 시 `redirect("/home/{생성 id}")`, 실패(ApiError) → `{ error: GENERIC }`(토큰/상세 비노출).
- `apps/web/app/moims/new/create-moim-form.tsx` (NEW) — Client Component, `useActionState`. 입력: 모임 이름/호스트 표시 이름/일정(`<input type="datetime-local" name="startsAt">`)/장소(`<input type="text" name="location">`). Meetup 오렌지 토큰(bg-primary 버튼 등). 에러 박스 + pending 비활성.
- `apps/web/app/(main)/home/HomeTab.tsx` (MODIFY):
  - `CreateMeetupButton` → `<Link href="/moims/new">`(기존 button 의 시각 스타일 유지, 동작만 링크화).
  - `MeetupCard` → 일정(startsAt 포맷 또는 "일정 미정") + 장소(location 존재 시 라인 추가, 없으면 생략) 표시. 기존 "개설일" 정리(최소 churn).
- `apps/web/app/(main)/home/[id]/page.tsx` (MODIFY) — 상세 헤더에 일정 + 장소 표시(정직 degrade). 멤버/채팅 섹션 보존.
- `apps/web/lib/moim/api.ts` (MODIFY) — `MoimDetail` 에 `startsAt: string | null` + `location: string | null` 추가.
- `apps/web/app/(main)/home/page.tsx` — `HomeTab` 에 넘기는 `moims`(listMoims 결과)가 이미 두 필드를 포함(api-client 재생성). 코드 변경 불필요(타입만 자동 확장).
- 게이트: web tsc 0, web lint 0, `nx run web:build` 0(`/moims/new` 등록).

## 3. 구현 단계 검증 체크포인트

다음을 구현 시점에 점검하며 진행한다(요구사항 충족 확인용):

- [ ] 마이그레이션이 additive(nullable, default 불요) — 기존 모임 조회 시 startsAt/location = null 로 정상 반환되는가?
- [ ] `createMoim` service 가 startsAt/location 을 받아도 owner 멤버십 트랜잭션이 그대로 원자적인가?
- [ ] startsAt 무효 문자열이 400 으로 차단되고, 부재/빈 값은 null 로 정상 저장되는가?
- [ ] name/nickname 누락 400 이 회귀 없이 보존되는가?
- [ ] api-client 재생성 후 `MoimResponse`/`CreateMoimRequest` 타입에 두 필드가 있는가?
- [ ] 생성 폼이 Meetup 오렌지 토큰을 쓰는가(onboarding blue 아님)?
- [ ] 생성 성공 시 `/home/{새 id}` 로 이동하고, 모바일에서 네이티브 push 로 처리되는가(디바이스 검증)?
- [ ] 홈 카드/상세가 일정/장소를 정직하게(null → 미정/생략) 표시하는가?

## 4. 검증 게이트 (요약)

spec.md §7 참조. 핵심: prisma migrate clean → backend jest(신규) → tsc 0(backend/web/api-client) → web lint 0 → web build 0 → mobile tsc/vitest/expo export 회귀 0 → 디바이스 종단 검증(생성 → 상세 push → 일정/장소 표시).

## 5. 위임/협의 권장

- 백엔드 스키마·DTO·service·jest: expert-backend 협의 가능(additive 마이그레이션 + no-ValidationPipe optional 처리).
- 웹 폼·Server Action·디자인 토큰: expert-frontend 협의 가능(useActionState 패턴 + Meetup 오렌지 일관).
