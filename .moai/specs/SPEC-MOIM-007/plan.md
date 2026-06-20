# SPEC-MOIM-007 구현 계획 (Plan)

> SPEC-MOIM-007: 투표 마감(deadline + 수동 마감) — 마감 후 투표 차단
> 본 계획은 파일별 작업 단위(milestone)와 기술 접근을 정의한다. 시간 추정은 사용하지 않으며 우선순위·순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

- **방법론**: 기존 도메인 확장(brownfield). 백엔드는 jest(신규 마감 + 열린 poll 투표 회귀), 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 검증. 백엔드 변경 → OpenAPI → api-client 재생성 → web 소비의 단방향 데이터 흐름(MOIM-005/006 동일).
- **데이터 흐름(순서 의존)**: (1) Prisma 스키마(closesAt 컬럼) + 비파괴 마이그레이션 → (2) poll 도메인(service vote 마감 검사 + closePoll 신규 + createPoll closesAt + aggregate closesAt/isClosed + DTO + 신규 close 라우트) → (3) backend jest(마감 신규 + 열린 poll 회귀) → (4) `nx run api-client:generate`(재생성) + 별칭 주석 갱신 → (5) web 헬퍼/타입 + close 헬퍼 + poll-actions close/closesAt + polls-section 마감 분기 + 생성 마감 입력 + page currentUserId 전달. 백엔드가 먼저 OpenAPI(closesAt/isClosed)를 바꿔야 api-client 타입에 반영된다.
- **additive 원칙**: `Poll.closesAt` 는 순수 nullable 컬럼 추가(`@default` 없음 → 기존 row 모두 null = 마감 없음). PK·FK·인덱스 변경 없음(MOIM-006 의 `(pollId,optionId,userId)` PK 그대로). 읽기 모델은 필드 2개 추가(제거 아님 — MOIM-006 myVote→myVotes 같은 break 아님).
- **멤버 스코핑 + 생성자 인가**: poll service 의 모든 진입(create/vote/list/close)은 첫 줄 `MoimService.assertMember(sub, moimId)` 호출 유지(MOIM-005/006 불변). 신규: `close` 는 assertMember 후 `poll.createdBy !== sub` → 403(생성자 전용 — poll 도메인 첫 행위자-소유 인가).
- **엔드포인트 shape**: 기존 라우트 3개(POST 생성 / GET 목록 / POST :pollId/vote) 그대로 + 신규 `POST :pollId/close`(생성자 전용 마감). vote 요청 바디 `{ optionId }` 그대로(마감 시 409 거부).
- **마감 판정 권위**: 서버 계산 `isClosed`(`closesAt != null && closesAt <= now`)를 응답에 담아 클라이언트가 자기 시계로 비교하지 않게 한다(시계 오차 차단). `closesAt`(ISO|null)는 표시용.
- **디자인 시스템**: Meetup 오렌지 시맨틱 토큰 — `(main)/home/[id]` 토큰을 따른다(login/onboarding blue 아님). 마감 배지/버튼은 차분한 muted 계열.

## 2. 데이터 모델 — closesAt 단일 컬럼 (핵심)

- 추가: `Poll.closesAt DateTime? @map("closes_at")`(nullable, `@default` 없음).
- 상태 도출: `null` = 마감 없음(영구 열림) / `closesAt > now` = 마감 예정(열림) / `closesAt <= now` = 마감됨(CLOSED).
- 한 컬럼이 deadline(생성 시 미래 시각)과 manual close(now 설정) 둘 다 표현. 수동 마감은 `closesAt = now` 로 즉시 CLOSED(미래 deadline 도 앞당겨 덮어씀 — 일찍 닫기).
- **마이그레이션 SQL(비파괴)**:
  ```sql
  ALTER TABLE "poll" ADD COLUMN "closes_at" TIMESTAMP(3);
  ```
  (정확한 타입/제약은 `prisma migrate diff` 출력으로 확인 — 위는 예시. nullable 이라 NOT NULL/DEFAULT 없음. poll_vote PK·FK·`@@index` 무변경.)
- 적용: `prisma migrate diff`(스키마↔DB)로 SQL 생성·검토 → `prisma db execute --file` 로 적용 → `prisma migrate resolve --applied {TS}_add_poll_closes_at` → `prisma migrate status` clean(MOIM-005/006 add_poll/add_poll_multi_select 선례). `prisma migrate dev` 의 파괴적 reset 회피(hand-edited add_chat 트리거 보존).

## 3. 마일스톤 (파일별 작업 단위)

순서는 데이터 흐름 의존성을 따른다(M1 → M5). 우선순위는 모두 본 SPEC 완료에 필수(High).

### M1 — 백엔드 스키마 + 비파괴 마이그레이션 (Priority: High)

- `apps/backend/prisma/schema.prisma` (MODIFY):
  - `model Poll` — `closesAt DateTime? @map("closes_at")` 1줄 추가(기존 컬럼·관계·`@@index([moimId])`·`multiSelect` 무변경). 주석 1줄(마감 시각 = deadline + 수동 마감 = now; null = 마감 없음).
- 마이그레이션(비파괴 패턴 — §2):
  - `apps/backend/prisma/migrations/{TS}_add_poll_closes_at/migration.sql` 수동 작성 — `poll.closes_at` nullable 컬럼 ADD 만. 다른 테이블/PK/FK 무변경.
  - `prisma migrate diff` 로 스키마↔DB 차이 확인 → `prisma db execute` 적용 → `prisma migrate resolve --applied {TS}_add_poll_closes_at` → `prisma migrate status` clean.
- 게이트: migrate status clean, 기존 poll/option/vote row 보존(row count 불변), 기존 모임/멤버/채팅/초대/단일·다중 투표 조회 회귀 0.

### M2 — 백엔드 poll 도메인 closesAt + vote 마감 차단 + closePoll + isClosed (Priority: High, depends: M1)

- `apps/backend/src/poll/dto/create-poll.dto.ts` (MODIFY) — `closesAt?: string` 추가(`@ApiProperty({ required: false, description: '마감 시각(ISO-8601). 생략 시 마감 없음.', example: '2026-06-25T12:00:00.000Z' })`). class-validator 미사용 — 컨트롤러가 파싱/400.
- `apps/backend/src/poll/dto/poll-response.dto.ts` (MODIFY) — `closesAt: string | null`(`@ApiProperty({ nullable: true, type: String, description: '마감 시각(ISO-8601) 또는 null(마감 없음)' })`) + `isClosed: boolean`(`@ApiProperty({ description: '서버 계산 마감 여부(closesAt != null && closesAt <= now)' })`) 추가. 기존 multiSelect/myVotes/options 보존.
- `apps/backend/src/poll/poll.service.ts` (MODIFY):
  - `PollWithResults` 인터페이스 — `closesAt: Date | null` + `isClosed: boolean` 추가.
  - `createPoll(sub, moimId, question, options, multiSelect, closesAt: Date | null)` — closesAt 파라미터 추가 → `poll.create` data 에 `closesAt`(null 이면 null 저장). 기존 assertMember + 트랜잭션 보존.
  - `vote(sub, moimId, pollId, optionId)` — assertMember → poll 일관성(404) → **마감 검사**(`poll.closesAt && poll.closesAt <= new Date()` → `ConflictException('마감된 투표입니다')` 409) → optionId 소속(400) → multiSelect 분기(단일 교체/다중 토글, MOIM-006 보존) 순서. 마감 검사를 분기 앞에 두어 단일/다중 공통 차단. 열린 poll 동작 보존.
  - `closePoll(sub, moimId, pollId): Promise<PollWithResults>` (신규) — assertMember(403/404) → `poll.findUnique` + `poll.moimId !== moimId` → 404 → `poll.createdBy !== sub` → `ForbiddenException` 403(생성자 전용) → `poll.update({ where: { id: pollId }, data: { closesAt: new Date() } })`(이미 마감이면 now 재설정 무해 — 멱등) → `aggregatePolls(sub, [updated])` 의 단건 반환.
  - `aggregatePolls` — 각 poll map 에 `closesAt: poll.closesAt` + `isClosed: poll.closesAt != null && poll.closesAt <= new Date()`(서버 계산) 추가. voteCount groupBy·myVotes 매핑 무변경.
- `apps/backend/src/poll/poll.controller.ts` (MODIFY):
  - `create` — `body.closesAt`(있으면) 파싱: `parseClosesAt(body?.closesAt)` 헬퍼 → 미제공 null, 제공 시 `new Date(v)` 무효(`Number.isNaN(getTime())`) → `BadRequestException` 400, 유효 시 Date. `createPoll(..., multiSelect, closesAt)` 전달.
  - 신규 `@Post(':pollId/close')` `@HttpCode(200)` — `closePoll(user.sub, moimId, pollId)` 호출 → `resultToDto`. `@ApiOkResponse`/`@ApiForbiddenResponse`(비멤버/비생성자 403)/`@ApiNotFoundResponse`(없는 poll 404) 데코.
  - `newPollToDto(poll)` — `closesAt: poll.closesAt?.toISOString() ?? null`, `isClosed: poll.closesAt != null && poll.closesAt <= new Date()`(신규 poll 은 보통 미래 deadline 이거나 null → false).
  - `resultToDto(poll)` — `closesAt: poll.closesAt ? poll.closesAt.toISOString() : null`, `isClosed: poll.isClosed`(service 계산값 그대로).
  - `requireNonEmpty`/`normalizeOptions` 헬퍼·기존 400/403/404 정책 무변경. 신규 `parseClosesAt` 헬퍼 추가.
- 게이트: tsc 0, OpenAPI 가 closesAt/isClosed 노출 + close 라우트 노출.

### M3 — backend jest (마감 신규 + 열린 poll 회귀) (Priority: High, depends: M2)

- `apps/backend/src/poll/poll.controller.spec.ts` (MODIFY) — 신규/갱신:
  - 생성: `closesAt` 유효 ISO 전달 시 service 가 Date 로 호출; 무효 ISO → 400(parseClosesAt); 생략 시 null 전달.
  - close 라우트: 컨트롤러가 `closePoll(sub, moimId, pollId)` 호출 + `resultToDto`(closesAt/isClosed) 매핑.
  - DTO 매핑: 신규 poll 응답에 closesAt(ISO|null)/isClosed. 기존 question 빈/옵션<2 400 회귀.
- `apps/backend/src/poll/poll.service.spec.ts` (MODIFY) — fake/mock prisma:
  - **마감 차단**: closesAt <= now poll 에서 vote → 409(표 불변), 단일 poll 과 다중 poll 둘 다.
  - **열린 회귀**: closesAt > now(또는 null) poll 에서 vote → MOIM-005/006 동작(단일 교체 총 1표 / 다중 토글 추가·제거).
  - **closePoll 인가**: 생성자(createdBy === sub) → closesAt=now + isClosed true; 멤버지만 비생성자 → 403; 비멤버 → assertMember 403; 멱등(두 번 close → 마감 유지).
  - **isClosed 계산**: closesAt null → false; closesAt 미래 → false; closesAt 과거/now → true. aggregatePolls/listPolls 가 정확히 채움.
  - vote 가 다른 poll 의 optionId → 400; 다른 모임 pollId → 404(마감/열림 공통).
  - 모든 진입(create/vote/list/close) 비멤버 → assertMember 403 전파(보존).
- `apps/backend/src/poll/poll.integration.spec.ts` (MODIFY) — fake store:
  - 마감 시각 생성 → 마감 전 투표 정상 → (시각 경과 또는 manual close) → 투표 409 end-to-end. 수동 마감(생성자 200 / 비생성자 403). 열린 poll 단일 교체·다중 토글 회귀.
  - 401/403/400/404/409 케이스. 마감 후 GET 결과 조회 가능(읽기 비차단) 확인.
- 게이트: backend jest 전체 통과(마감 신규 + 열린 poll 회귀), branch coverage floor 유지(NestJS DI/decorator phantom branch `collectCoverageFrom` 제외 정책 — backend-nestjs-coverage 메모리).

### M4 — api-client 재생성 + poll 타입 (Priority: High, depends: M2)

- `nx run api-client:generate` — 백엔드 OpenAPI(CreatePollDto.closesAt, PollResponseDto.closesAt + isClosed, close 라우트)를 반영해 `packages/api-client/src/schema.d.ts` 재생성. 수동 편집 금지.
- `packages/api-client/src/index.ts` (MODIFY) — 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`) 유지, 주석 갱신(`closesAt`/`isClosed` 추가, multiSelect/myVotes 보존). 편의 메서드 추가 없음(path-param close → web 구체-경로 헬퍼 유지).
- 게이트: api-client tsc 0(재생성된 schema 와 별칭 일치).

### M5 — 웹 헬퍼/타입 + 마감 렌더 + 생성 마감 입력 + 마감하기 버튼 (Priority: High, depends: M4)

- `apps/web/lib/moim/polls.ts` (MODIFY) — `PollWithResults` 타입에 `closesAt: string | null` + `isClosed: boolean` 추가. 신규 `closePoll(api, moimId, pollId): Promise<PollResponse>` 구체-경로 헬퍼(`POST /moims/{moimId}/polls/{pollId}/close`, body 없음). 기존 헬퍼 시그니처 무변경.
- `apps/web/app/(main)/home/[id]/poll-actions.ts` (MODIFY):
  - `createPollAction` — `formData.get("closesAt")`(datetime-local)를 `toIsoOrUndefined`(moims/new 미러 — 동일 헬퍼 복제 또는 공유)로 변환해 `createPoll(api, moimId, { question, options, multiSelect, closesAt })` 전달(빈 값 → undefined → 미전송 → null).
  - 신규 `closePollAction(moimId, pollId): Promise<CloseActionState>` — 세션(`requireToken`) → `closePoll(api, moimId, pollId)` → 성공 시 `revalidatePath("/home/{moimId}")`. 백엔드 오류(403/404/네트워크) → 일반화 오류. `voteAction` 무변경(마감 시 백엔드 409 → 일반화 오류 + 재검증으로 마감 상태 반영).
- `apps/web/app/(main)/home/[id]/polls-section.tsx` (MODIFY):
  - `OptionRow` — `disabled` prop 에 마감(pending || isClosed) 반영(마감 시 클릭 불가). 결과 막대/강조는 계속 렌더.
  - `PollCard` — `poll.isClosed` 분기: 마감이면 "마감됨" 배지(muted) + 옵션 버튼 비활성 + `closesAt` 표시; 열림이면 MOIM-005/006 그대로. `poll.createdBy === currentUserId && !poll.isClosed` 면 "마감하기" 버튼(차분 secondary, `closePollAction` 호출, useTransition). `closesAt` 설정 시 "마감: {시각}"/마감됨 표시.
  - `CreatePollForm` — "마감 시각"(`datetime-local`, optional, name="closesAt") 입력 추가(Meetup 오렌지, moims/new 일정 미러). 라벨 "(선택)".
  - `PollsSection` — `currentUserId: string` prop 추가 → 각 `PollCard` 에 전달(생성자 버튼 판정).
- `apps/web/app/(main)/home/[id]/page.tsx` (MODIFY) — Server Component 가 세션 user.id(sub)를 읽어(이미 세션 접근 패턴 존재) `<PollsSection currentUserId={sub} moimId=... polls=.../>` 로 전달. polls fetch 흐름 무변경. 직렬화 가능 string 만 전달(Server→Client 경계).
- 게이트: web tsc 0(closesAt/isClosed/currentUserId 전 소비처), web lint 0, `nx run web:build` 0(마감 분기 + 마감 입력 + 마감하기 버튼 컴파일).

## 4. 구현 단계 검증 체크포인트

다음을 구현 시점에 점검하며 진행한다(요구사항 충족 확인용):

- [ ] `Poll.closesAt` 가 additive nullable(`@default` 없음)이고 기존 poll row 가 모두 null(마감 없음)을 유지하는가? PK/FK/인덱스 무변경인가? migrate status clean 인가?
- [ ] create 가 closesAt 옵트인(생략 시 null)을 받고, 무효 ISO 는 400, 마감 없는 생성 경로가 무변경(MOIM-005/006 회귀 0)인가?
- [ ] vote 가 마감(closesAt <= now) poll 에서 409("마감된 투표입니다")로 차단하고 표를 안 바꾸는가 — 단일 AND 다중 공통? 열린 poll 은 교체/토글 그대로(회귀 0)인가?
- [ ] closePoll 이 생성자(createdBy === sub)면 closesAt=now 로 마감, 비생성자 멤버 403, 비멤버 403, 이미 마감이면 멱등(200, 마감 유지)인가?
- [ ] GET 이 각 poll 의 closesAt(ISO|null) + 서버 계산 isClosed(closesAt!=null && <=now)를 반환하는가? 마감된 poll 도 결과(voteCount/myVotes) 조회 가능한가?
- [ ] vote 라우트의 우선순위(assertMember → poll 일관성 404 → 마감 409 → optionId 400 → 분기)가 마감 poll 에서 어떤 optionId 든 투표 불가로 동작하는가?
- [ ] closesAt/isClosed 추가의 모든 소비처(DTO/OpenAPI/api-client PollResponse/web PollWithResults/page→PollsSection)가 갱신되어 tsc 0 인가?
- [ ] api-client 재생성 후 CreatePollRequest 에 optional closesAt, PollResponse 에 closesAt/isClosed 가 있고 multiSelect/myVotes 가 보존되는가?
- [ ] web 마감 poll 이 "마감됨" 배지 + 비활성 컨트롤 + 결과 표시로, 열린 poll 은 MOIM-005/006 그대로(투표 가능) 렌더되는가?
- [ ] 생성 폼 "마감 시각"(datetime-local, optional)이 Meetup 오렌지이고 미입력 시 null 인가? 입력 시 ISO 로 전달되는가?
- [ ] 열린 poll 에 생성자에게만 "마감하기" 버튼이 보이고(비생성자/마감 poll 엔 미노출), 누르면 마감되어 갱신되는가(revalidatePath)?
- [ ] 마감/생성/투표 후 결과가 `revalidatePath` 로 갱신되는가(디바이스 검증)?

## 5. 검증 게이트 (요약)

spec.md §7 참조. 핵심: prisma migrate clean(closesAt nullable 추가, PK/FK 무변경, 기존 row 보존) → backend jest(마감 신규: closesAt 생성·무효 ISO 400·vote 409 단일/다중·closePoll 생성자/비생성자/비멤버/멱등·isClosed 계산 + 열린 poll 회귀: closesAt 생략·단일 교체·다중 토글) → tsc 0(backend/web/api-client, closesAt/isClosed/currentUserId 전파) → web lint 0 → web build 0 → mobile tsc/vitest/expo export 회귀 0 → 디바이스 종단 검증(마감 시각 생성 → 마감 전 투표 → "마감하기" → 배지+비활성+결과표시 → 마감 후 투표 409 차단).

## 6. 위임/협의 권장

- 백엔드 closesAt nullable 마이그레이션·vote 마감 검사(409 분기 앞)·closePoll 생성자 전용 인가·isClosed 서버 계산·jest 회귀: expert-backend 협의 가능(비파괴 SQL + 마감 차단 + 행위자-소유 인가 + 멱등).
- 웹 마감 렌더 분기(배지/비활성/결과 표시)·생성 마감 시각 입력·"마감하기" 버튼(생성자 + 열림 판정)·currentUserId 전달·디자인 토큰: expert-frontend 협의 가능(Client 섬 보존 + datetime-local 미러 + Meetup 오렌지 일관 + Server→Client 직렬화 경계).
