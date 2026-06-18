# SPEC-MOIM-004 수용 기준 (Acceptance Criteria)

> SPEC-MOIM-004: 모임 생성 UI 기능화 + 이벤트 일정/장소 필드
> 각 AC 는 EARS 요구사항(spec.md §2)에 추적되며 Given-When-Then 시나리오로 검증한다.
> 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 iOS 시뮬레이터 확인. 백엔드는 jest. api-client 는 tsc.

## 수용 기준 (AC)

### AC-1: Moim 이벤트 필드 + additive 마이그레이션 (← REQ-MOIM4-001)

`Moim` 에 nullable `startsAt` + `location` 이 추가되고, 마이그레이션이 additive 로 적용된다(기존 모임 null, 무중단). backend jest 가 일정/장소 포함 생성 + 미포함 생성(둘 다 동작) + 조회 응답의 두 필드를 커버한다.

- **Given** 기존 모임 row(startsAt/location 컬럼 없음)가 있고
- **When** 마이그레이션을 적용하면
- **Then** 두 컬럼이 nullable 로 추가되고 기존 row 는 두 값 모두 NULL 이며, 기존 조회/생성/멤버/채팅/초대 동작에 회귀가 없다.

### AC-2: 생성 엔드포인트 — optional 필드 영속 + 400 보존 (← REQ-MOIM4-002)

`POST /moims` 가 optional `startsAt`/`location` 을 받아 영속하고, owner 멤버십 트랜잭션은 불변이며, `name`/`nickname` 누락은 여전히 400 이다.

- **Given** 인증 사용자가
- **When** `{ name, nickname, startsAt, location }` 으로 `POST /moims` 를 호출하면
- **Then** 201 + 모임이 startsAt/location 과 함께 생성되고 생성자가 owner 멤버십을 갖는다.
- **And When** `startsAt`/`location` 없이 `{ name, nickname }` 만 보내면 **Then** 201 + 두 필드가 null 인 모임이 생성된다.
- **And When** `name` 또는 `nickname` 이 비어 있으면 **Then** 400 을 반환한다(회귀 보존).
- **And When** `startsAt` 이 무효 문자열이면 **Then** 400 을 반환한다.

### AC-3: 조회 응답에 일정/장소 포함 (← REQ-MOIM4-003)

`GET /moims` 와 `GET /moims/:id` 가 `startsAt`(ISO 또는 null) + `location`(문자열 또는 null)을 반환하며, 멤버 스코핑(403/404)은 약화되지 않는다.

- **Given** 일정/장소가 있는 모임과 없는(null) 모임이 모두 있고 사용자가 두 모임의 멤버일 때
- **When** `GET /moims` 를 호출하면 **Then** 각 항목이 startsAt/location 을 정확히(값 또는 null) 포함한다.
- **And When** `GET /moims/:id` 를 호출하면 **Then** 동일하게 두 필드를 포함한다.
- **And When** 비멤버가 `GET /moims/:id` 를 호출하면 **Then** 여전히 403(미존재는 404)이다.

### AC-4: 기능형 생성 플로우 (← REQ-MOIM4-005)

홈의 "새 모임 만들기" CTA 가 기능형 생성 폼을 열고, 제출(이름 + 호스트 표시 이름 [+ optional 일정/장소])이 실제 모임을 생성해 그 상세로 이동한다.

- **Given** 인증·이름 보유 사용자가 홈(`/home`)에 있고
- **When** "새 모임 만들기" 를 탭하면 **Then** `/moims/new` 생성 폼(이름/호스트 표시 이름/일정/장소 입력)이 열린다.
- **And When** 이름 + 호스트 표시 이름(+ 선택적 일정/장소)을 입력해 제출하면 **Then** 실제 모임이 생성되고 새 모임 상세 `/home/{id}` 로 이동한다.

### AC-5: 일정/장소 정직 표시 + Meetup 디자인 (← REQ-MOIM4-006)

홈 카드와 상세가 일정/장소를 정직하게 렌더한다(null → "일정 미정"/장소 라인 생략, 허위 값 금지) — Meetup 오렌지 디자인 시스템으로.

- **Given** 일정/장소가 있는 모임과 없는 모임이 목록에 있을 때
- **When** 홈 카드를 보면 **Then** 값 있는 모임은 포맷된 일정/장소를 보이고, 없는 모임은 "일정 미정"(장소는 생략)으로 보인다 — 허위/플레이스홀더 값 없음.
- **And When** 상세 `/home/{id}` 를 보면 **Then** 동일한 정직 표시가 적용되고, 생성 폼·카드·상세가 모두 Meetup 오렌지 토큰(`bg-primary` 등)을 쓴다(login/onboarding blue 아님).

### AC-6: 품질 게이트 (← spec.md §7)

backend jest 통과(신규 케이스 포함), backend+web+api-client tsc 0, web lint 0, web build 0, prisma migrate clean, mobile tsc/vitest/expo export 회귀 0.

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면
- **Then** 위 모든 자동 게이트가 GREEN 이고, 디바이스 종단 검증(생성 → 상세 push → 일정/장소 표시)이 통과하면 status 가 completed 로 전환된다.

## 엣지 케이스 (Edge Cases)

- **빈 폼 제출**: name/nickname 빈 값 제출 → 생성 폼에 머무르며 일반화된 오류 표시(`/login` 이동 없음, 모임 미생성). (← REQ-MOIM4-005 Unwanted)
- **백엔드 생성 오류**: `createMoim` 이 400/네트워크 오류 → 폼 머무름 + 일반화 오류(토큰/오류 상세 비노출). (← REQ-MOIM4-005 Unwanted)
- **세션 만료 후 제출**: server-action 시점 세션 부재 → `/login` 리다이렉트(모임 미생성). (← REQ-MOIM4-005)
- **무효 startsAt**: 폼이 datetime-local 만 쓰면 무효 입력은 드물지만, 백엔드는 무효 ISO 를 400 으로 차단한다(API 직접 호출 방어). (← REQ-MOIM4-002 Unwanted)
- **일정만 / 장소만 입력**: 한쪽만 입력해도 정상 생성되고 반대쪽은 null 로 정직 표시. (← REQ-MOIM4-006)
- **datetime-local 타임존**: 로컬 시각 입력 → ISO 변환 시 브라우저 타임존으로 해석(MVP 허용 — 타임존 정규화는 제외 범위). (← spec.md §5)
- **미인증 직접 진입**: `/moims/new` 직접 URL 접근 시 `moims` 그룹 가드가 미인증 → `/login`, 이름 미보유 → `/onboarding`. (← REQ-MOIM4-005 State-driven)
- **데스크톱 vs 모바일**: 생성 페이지는 데스크톱 일반 라우팅 + 모바일 in-WebView(네이티브 라우트 없음). 생성 후 `/home/{id}` 는 데스크톱 일반 / 모바일 네이티브 push(SPEC-MOIM-003 기존 계약).

## Definition of Done (DoD)

- [x] `Moim` 에 `startsAt DateTime?` + `location String?` 추가, additive 마이그레이션 적용(기존 row null), prisma migrate clean. (AC-1) — 라이브 검증 2026-06-19
- [x] `CreateMoimDto` optional startsAt/location, `MoimResponseDto` startsAt/location nullable 직렬화. (AC-2/AC-3) — 라이브 검증 2026-06-19
- [x] `createMoim` service 가 두 필드를 영속하고 owner 멤버십 트랜잭션 불변. (AC-2) — 라이브 검증 2026-06-19
- [x] controller 가 optional 필드 처리 + startsAt 무효 400 + name/nickname 누락 400 보존. (AC-2) — 라이브 검증 2026-06-19
- [x] `GET /moims`·`GET /moims/:id` 응답에 두 필드 포함, 멤버 스코핑 약화 0. (AC-3) — 라이브 검증 2026-06-19
- [x] backend jest 신규 케이스(포함/미포함 생성, 조회 필드, 무효 startsAt 400, 누락 400) 통과. (AC-1/AC-2/AC-3/AC-6) — backend jest 222/222
- [x] `schema.d.ts` 재생성 + api-client `createMoim()` + `CreateMoimRequest` 별칭, tsc 0. (AC-2/AC-6) — tsc 0(backend/web/api-client/mobile)
- [x] `/moims/new` 생성 페이지 + 폼(useActionState) + Server Action(`createMoimAction`), 성공 시 `/home/{id}` 이동. (AC-4) — 라이브 검증 2026-06-19
- [x] 홈 카드 + 상세에 일정/장소 정직 표시(null → 미정/생략), Meetup 오렌지 토큰. (AC-5) — 라이브 검증 2026-06-19
- [x] web tsc 0 / web lint 0 / web build 0(`/moims/new` 등록). (AC-6) — 게이트 통과
- [x] mobile tsc/vitest/expo export 회귀 0(모바일 무변경). (AC-6) — mobile vitest 215/215
- [ ] 디바이스 종단 검증: 홈 CTA → 생성 폼(일정/장소) → 제출 → 상세 push → 일정/장소 표시 라이브 확인. (AC-6, device-gated) — iOS 시뮬레이터에서 server-action redirect → `/home/{id}` 시 SPEC-MOIM-003 `detailRouteForUrl` push 트리거 검증 대기
