---
id: SPEC-MOIM-EXPENSE-001
version: 0.2.0
status: draft
created: 2026-06-24
updated: 2026-06-24
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-EXPENSE-001: 모임 경비 기록 + 시각화 (MVP) — owner 기록 / 전 멤버 투명 조회 + 정산

## HISTORY

- 2026-06-24 (v0.2.0): §8 미해결 결정 6건 사용자 확정 반영 — 본문에 통합하고 §8 을 "확정된 결정" 기록으로 전환.
  **(1) 분배 모델**: 균등(N빵 기본) **AND** 커스텀(특정 멤버 / 멤버별 금액 / **비율**) 둘 다 MVP 포함 — ExpenseShare 가
  두 방식 모두 기록 시점에 분담을 materialize(비율 입력은 생성 시 금액으로 환산해 저장, 나머지 결정적 배분으로 합=amount).
  **(2) 위치**: 인라인 섹션 → **전용 라우트 `/moims/[id]/expenses`**(채팅 미러 — `moims` 그룹, `moims/layout.tsx`
  이름 가드 상속, **3세그먼트라 모바일 `detailRouteForUrl` 이 native-dispatch 하지 않고 in-WebView 유지** — 신규 native
  코드 0). 모임 상세(`/home/[id]`)에 "경비" 진입 버튼("채팅 입장" 미러) 추가. **(3) 정산 완료 토글**: MVP 포함 —
  신규 `Settlement` 영속 레코드(`moimId`/`fromUserId`/`toUserId`/`amount`/`settledAt`/`settledBy`) + owner 토글 라우트.
  **의미론(채택)**: settled 마커는 **정보성 스냅샷**이다 — 정산 거래는 항상 경비(balance)에서 재계산하고, 계산된 거래가
  같은 `(from,to,amount)` 의 settled 마커와 매칭되면 "정산 완료"로 표시한다. 경비 변경으로 balance 가 다시 벌어져 거래
  금액/짝이 달라지면 그 거래는 **미해소로 재출현**한다(마커는 삭제되지 않고 stale 로 남아 재출현 거래와 매칭되지 않음 —
  자동 송금/취소를 일으키지 않는 안전 기본값). 정산 변경도 realtime 전파. **(4) 경비 수정**: MVP 포함 —
  `PATCH /moims/:id/expenses/:expenseId`(owner, ExpenseShare 재 materialize). **(5) 통화**: KRW 정수 확정(소수점 없음).
  **(6) 예산 엔드포인트**: 전용 라우트 없이 기존 `PATCH /moims/:id`(maxMembers 수정 라우트)가 optional `budget` 도
  수용하도록 확장(전용 예산 라우트·`setBudget` 별도 메서드 불필요 — `updateMaxMembers` 를 `updateMoimSettings` 류로
  확장). 결과: REQ 11개(REQ-EXP-001~011) + AC 13개(AC-1·2·2b·3~12) — v0.1.0 의 9 REQ + AC 10개에서 확장.
- 2026-06-24 (v0.1.0): 최초 draft. 모임 경비(모임통장 공유내역 형태)의 **기록 + 시각화 MVP**. moyura 모임 도메인
  (MOIM-001/002 백엔드 6라우트 + 인가 단일 출처, MOIM-004 일정/장소, MOIM-005~010 투표, MOIM-012 정원·멤버 realtime)
  위에 **경비** 하위 도메인을 additive 로 추가한다. **WHO**: 모임 **owner(주최자)가 경비를 기록**하고(assertOwner),
  **전 멤버가 조회**한다(assertMember — 투명성, 모임통장 공유내역 같은 신뢰 모델). **WHAT(MVP)**: (1) 빠른 기록 —
  FAB → 바텀시트(금액 KRW 정수 / 카테고리 프리셋 칩 / 결제자 / 메모? / 분배 방식 균등(N빵) 기본 + 커스텀);
  (2) 시각화 — 요약 카드(총지출·1인당·남은예산), 카테고리 도넛(구성%), 멤버별 기여 막대 + **정산 리스트(누가 누구에게
  얼마 — Tricount식 최소 거래)**; (3) 선택적 모임 예산(`Moim.budget` — owner 설정, 남은예산 산정); (4) **realtime** —
  같은 private 채널 `moim:{id}` 에 `expense_change` 이벤트 추가(경비 추가/수정/삭제가 전 멤버에 라이브 반영,
  member_change 미러). **데이터**: `Expense`(moimId FK cascade / amount / category / payerUserId / memo? / createdBy /
  createdAt) + `ExpenseShare`(per-member 분담, 복합 PK `(expenseId,userId)` + shareAmount) — **균등 분배도 생성 시
  분담 행을 materialize** 해 기록 시점 분담을 고정한다(멤버십 변경 후에도 불변 — PollVote 가 표를 고정하는 것과 동형).
  `Moim.budget Int?`(additive nullable — 예산 미설정 허용). **정산은 서버 계산**(balance = payer 합 − share 합 →
  채권/채무 → greedy 최소 거래 매칭, aggregatePolls 미러). **API(중첩 라우트, PollController 미러)**: `POST/GET/DELETE
  /moims/:id/expenses`(+ optional `PATCH .../:expenseId`) + 예산 설정. **하이브리드 불변**: 경비 UI 는 웹 상세
  `/home/[id]` in-WebView 렌더 → 모바일 네이티브 코드 없음. **영수증 OCR·기간/추세 막대·예산대비 실적 차트·Sankey·
  CSV·카카오 1/N 송금·모임통장 연동은 MVP 제외(§4, v2/v3)**. 근거: 조사 자료 `research.md`(재사용 패턴·file:line 고정).
  본 SPEC은 **신규 하위 도메인**(greenfield 안에 brownfield 인프라 재사용)이므로 §3 델타 마커는 [ADD] 중심 +
  [EXISTING] 재사용 인프라로 구성한다. 미해결 결정 6건은 §8 에 명시했다(v0.2.0 에서 모두 확정 반영).

---

## 1. 개요 (Overview)

모임을 운영하면 누군가 식비·교통·숙박·입장료를 대신 결제하고, 나중에 "총 얼마 썼고 1인당 얼마이며 누가 누구에게
얼마를 보내야 하는가"를 정리해야 한다. 현재 moyura 의 모임 상세(`/home/[id]`)는 이름·일정·장소·멤버·채팅·투표를
제공하지만 **경비를 다룰 수단이 없다**. 본 SPEC은 **모임통장 공유내역**과 같은 신뢰 모델 — **주최자가 지출을
투명하게 올리면 전 멤버가 그 내역과 정산을 본다** — 을 **전용 경비 화면**(`/moims/[id]/expenses`, 모임 상세의 "경비"
진입 버튼으로 도달 — "채팅 입장" 미러)으로 추가한다.

본 MVP의 범위는 네 덩어리다:

1. **기록 + 수정(owner 전용)** — 모임 owner 가 경비 화면의 FAB → 바텀시트로 경비를 빠르게 기록/수정한다: **금액(KRW
   정수)**, **카테고리**(프리셋 칩 — 식비/교통/숙박/입장/준비물/기타), **결제자**(기본 = 기록자/owner, 멤버 중 선택
   가능), **메모**(선택), **분배 방식** — **균등(N빵) 기본** + **커스텀**(특정 멤버 선택 / 멤버별 금액 / 멤버별 비율).
   비율 입력은 생성 시 금액으로 환산해 저장한다. 영수증 사진·OCR 은 제외(v2).
2. **조회 + 시각화(전 멤버)** — 모바일-퍼스트 카드 UI 로 경비 화면에서: (A) **요약 카드** — 총 지출 / 1인당 / 남은
   예산(예산 설정 시); (B) **카테고리 도넛**(구성 %); (C) **멤버별 기여 막대 + 정산 리스트** — 멤버별 결제액 막대 +
   "누가 누구에게 얼마"의 **최소 거래** 리스트(Tricount식). 기간/추세 막대·예산대비 실적·Sankey 는 제외(v2/v3).
3. **정산 완료 토글(영속)** — 계산된 정산 거래에 대해 owner 가 "정산 완료"를 표시하면 그 상태가 `Settlement` 레코드로
   **영속**된다. settled 마커는 **정보성 스냅샷**이다 — 정산 거래는 항상 경비에서 재계산하고, 계산된 거래가 같은
   `(from,to,amount)` settled 마커와 매칭되면 "정산 완료"로 표시한다. 경비 변경으로 balance 가 달라지면 그 거래는
   미해소로 재출현한다(마커는 자동 삭제·재송금을 일으키지 않는 안전 기본값 — §5 의미론).
4. **realtime + 예산(선택)** — 경비 추가/수정/삭제·정산 토글은 같은 private 채널 `moim:{id}` 의 `expense_change`
   이벤트로 전 멤버에 라이브 반영된다(member_change 미러). owner 는 모임 예산(`Moim.budget`)을 기존 `PATCH /moims/:id`
   (maxMembers 수정 라우트)로 선택적 설정해 "남은 예산"을 띄울 수 있다(미설정 허용).

데이터는 **additive** 다 — 신규 테이블 `Expense`/`ExpenseShare`/`Settlement` + `Moim.budget`(nullable) 컬럼만 추가하고
기존 테이블(moim/poll/chat/member)은 무변경(역참조만). **균등·커스텀 분배 모두 생성 시 분담 행을 materialize** 한다 —
멤버가 나중에 강퇴/탈퇴해도 기록 시점의 "누가 얼마를 부담"이 보존되어야 정산이 정확하기 때문이다(PollVote 행이 그 시점
표를 고정하는 것과 동형). **정산은 서버에서 계산**한다(클라 계산 금지 — aggregatePolls 가 myVotes 를 서버에서 계산하는
철학과 일관): 멤버별 balance(자기가 결제한 합 − 자기 분담 합)를 구하고, 채권자/채무자를 분리해 greedy 로 최소 거래 집합을
만든 뒤 각 거래에 settled 마커 매칭 여부를 표시한다.

인가는 기존 단일 출처를 그대로 쓴다: **기록/수정/삭제 + 정산 토글 + 예산 설정 = `MoimService.assertOwner`(owner 전용)**,
**목록/정산 조회 = `assertMember`(전 멤버)**. 즉 쓰기는 owner, 읽기는 멤버다. 상태 코드는 기존 관례(401 가드 / 403
비멤버·비-owner / 404 없는 모임·타-모임 자원 / 400 검증)를 미러한다.

아키텍처는 하이브리드(불변)다 — 웹이 화면 콘텐츠를 소유하고 모바일이 네이티브 크롬을 소유한다. 경비 UI(FAB·기록
바텀시트·요약 카드·도넛·정산 리스트·정산 토글)는 **전용 웹 라우트 `/moims/[id]/expenses`** 안에서 in-WebView 로
렌더된다. 이 라우트는 채팅(`/moims/[id]/chat`)과 동일하게 `moims` 그룹에 속해 `moims/layout.tsx` 의 이름 가드를 상속하고,
**3세그먼트 경로라 모바일 `route-map-core.detailRouteForUrl` 이 native-dispatch 대상에서 제외**(채팅과 동형 — `/home/[id]`
2세그먼트만 detail-push)하므로 **모바일 신규 네이티브 코드는 없다**(WebView 내부 이동). realtime 도 백엔드 NestJS 코드
변경 없이 순수 DB 트리거로 발화한다.

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 11개다. 각 모듈은 `REQ-EXP-NNN` 으로 번호를 부여하며(기존 REQ-MOIMn-XXX 네임스페이스와 분리)
모두 테스트 가능하고 §6 수용 기준의 AC 로 추적된다.

### REQ-EXP-001: 경비 데이터 모델 — Expense + ExpenseShare + Settlement + Moim.budget (Ubiquitous)

- **The backend shall** 신규 테이블 `Expense` 를 추가한다: `id`(uuid PK), `moimId`(FK → moim, `onDelete: Cascade`),
  `amount`(Int — KRW 정수, ≥1), `category`(String — 프리셋 값 중 하나), `payerUserId`(String — 결제자 sub, 그 모임의
  멤버), `memo`(String?, nullable), `createdBy`(String — 기록자 sub), `createdAt`(DateTime `@default(now())`),
  `updatedAt`(DateTime `@updatedAt` — 수정 시각, DeviceToken 선례). 컬럼은 `@map` snake_case(`moim_id`/`payer_user_id`/
  `created_by`/`created_at`/`updated_at`)로 매핑하고 `@@index([moimId])` 로 모임별 목록 조회를 커버한다.
- **The backend shall** 신규 테이블 `ExpenseShare` 를 추가한다: `expenseId`(FK → expense, `onDelete: Cascade`),
  `userId`(String — 분담 멤버 sub), `shareAmount`(Int — 그 멤버의 분담액, KRW 정수, ≥0), `createdAt`. **복합 PK
  `@@id([expenseId, userId])`** 가 "경비당 멤버당 한 분담 행" 불변식을 DB 레벨에서 강제한다(MoimMember/PollVote 복합
  PK 선례). `@@index([userId])` 로 멤버별 분담 조회를 커버한다. **비율 분배는 별도 컬럼을 두지 않는다** — 비율은 생성/
  수정 시 금액으로 환산해 `shareAmount` 로만 저장한다(REQ-EXP-004).
- **The backend shall** 신규 테이블 `Settlement` 를 추가한다(정산 완료 마커 영속): `id`(uuid PK), `moimId`(FK → moim,
  `onDelete: Cascade`), `fromUserId`(String — 보내는 멤버 sub), `toUserId`(String — 받는 멤버 sub), `amount`(Int — 정산
  당시 계산된 거래 금액, KRW 정수, ≥1), `settledBy`(String — 토글한 owner sub), `settledAt`(DateTime `@default(now())`).
  컬럼은 `@map` snake_case 로 매핑하고 `@@index([moimId])` 로 모임별 마커 조회를 커버한다. 마커는 계산된 거래의 스냅샷이며
  (from,to,amount) 으로 거래와 매칭된다(§5 의미론). 복합 PK 가 아니라 surrogate id 를 둔다 — 같은 (from,to,amount) 거래가
  경비 변동으로 사라졌다 재출현해도 과거 마커와 새 마커를 구별·정리할 수 있게 하기 위함.
- **The backend shall** `Moim` 에 `budget Int?`(nullable, `@map("budget")`) 컬럼을 additive 로 추가한다 — 예산 미설정
  모임은 `null`(기존 row 모두 null). `Moim` 의 다른 컬럼(name/startsAt/location/createdBy/maxMembers/createdAt)·PK·기존
  역참조는 **그대로 보존**한다(순수 컬럼 추가).
- **The backend shall** `Moim`/`Expense`/`ExpenseShare`/`Settlement` 의 FK 를 `onDelete: Cascade` 로 두어 모임 삭제 시
  expense → expense_share 와 settlement 마커가 함께 정리되게 한다(데이터 무결성 — 삭제 UI 가 아니라 FK 제약).
- **The backend shall** 마이그레이션을 **비파괴 additive** 로 작성한다 — `Moim.budget` 컬럼 추가(`add_moim_event_fields`/
  `add_moim_max_members` 선례) + `expense`/`expense_share`/`settlement` 테이블 CREATE(`add_poll` 선례) + (REQ-EXP-008)
  realtime 트리거. 기존 테이블/컬럼/PK 변경 없음.

### REQ-EXP-002: 경비 기록 — owner 전용 + 검증 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 모임 **owner** 가 `{ amount, category, payerUserId, memo?, splitMethod, participantUserIds?,
  shares? }`(`splitMethod` ∈ `"equal"|"custom"|"ratio"`, 생략 시 `"equal"`)로 `POST /moims/:id/expenses` 를 호출하면,
  **the backend shall** `assertOwner` 통과 후 분담을 산정(REQ-EXP-004)해 `Expense` 1행 + `ExpenseShare` N행을 하나의
  트랜잭션으로 생성하고 생성된 경비(+분담)를 201 로 반환한다.
- (Unwanted behavior) **IF** `amount` 가 정수가 아니거나 1 미만이면, **then the backend shall** `400 Bad Request` 를
  반환한다(통화 KRW 정수 — 소수점·음수·0 거부).
- (Unwanted behavior) **IF** `category` 가 프리셋 값(식비/교통/숙박/입장/준비물/기타 — REQ-EXP-003) 외이면, **then the
  backend shall** `400 Bad Request` 를 반환한다.
- (Unwanted behavior) **IF** `payerUserId` 가 그 모임의 멤버가 아니면, **then the backend shall** `400 Bad Request` 를
  반환한다(결제자는 멤버여야 함).
- (Unwanted behavior) **IF** 요청 사용자가 그 모임의 **owner 가 아니면**(또는 모임이 미존재이면), **then the backend
  shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertOwner` 단일 출처 — 비-owner 기록 차단).

### REQ-EXP-003: 카테고리 프리셋 (Ubiquitous)

- **The backend shall** 경비 카테고리를 고정 프리셋 — `식비`/`교통`/`숙박`/`입장`/`준비물`/`기타` — 중 하나로만
  받는다(미지 값 400 — REQ-EXP-002). 카테고리는 string 값으로 저장하며 DB enum/CHECK 제약이 아니라 컨트롤러가
  허용 값을 검증한다(`parseKind` 선례 — enum 마찰 회피).
- **The web app shall** 기록 폼에서 카테고리를 **프리셋 칩**(선택형 버튼 그룹)으로 노출하고 선택값을 그대로 전송한다.
  카테고리 신규 추가/자유 입력은 MVP 제외(§4).

### REQ-EXP-004: 분배 — 균등(N빵) 기본 + 커스텀(금액/비율), 분담 materialize (Event-driven / State-driven / Unwanted behavior 혼합)

- (State-driven, 균등 기본) **WHILE** `splitMethod` 가 `"equal"`(생략 시 기본)인 동안, **WHEN** 경비를 기록/수정하면,
  **the backend shall** `participantUserIds`(생략 시 = 그 모임의 전 멤버)에게 `amount` 를 **균등 분배**해 각 멤버의
  `ExpenseShare.shareAmount` 를 산정·저장한다 — 나누어떨어지지 않는 나머지(원 단위)는 결정적 규칙으로 배분하고
  (예: 앞선 참가자에게 1원씩) **분담 합 = amount** 를 보장한다.
- (State-driven, 커스텀 금액) **WHILE** `splitMethod` 가 `"custom"` 이고 분배 단위가 금액인 동안, **WHEN** 경비를 기록/
  수정하면, **the backend shall** 요청의 `shares`(`{ userId, amount }[]`)를 그대로 `ExpenseShare.shareAmount` 로 저장한다.
- (State-driven, 커스텀 비율) **WHILE** `splitMethod` 가 `"ratio"` 인 동안, **WHEN** 경비를 기록/수정하면, **the backend
  shall** 요청의 `shares`(`{ userId, ratio }[]`)의 비율 합으로 `amount` 를 안분해 각 멤버의 `shareAmount`(정수)를
  **금액으로 환산·저장**한다 — 안분 나머지(원 단위)는 균등과 동일한 결정적 규칙으로 배분해 **분담 합 = amount** 를
  보장한다. 비율 자체는 `ExpenseShare` 에 저장하지 않는다(환산 결과 금액만 영속 — 정산 코드는 항상 금액만 읽는다).
- (Unwanted behavior) **IF** 커스텀 금액(`"custom"`)의 `shares` 합이 `amount` 와 일치하지 않거나, 비율(`"ratio"`)의
  비율 합이 0 이하이거나, 어떤 `userId` 가 그 모임의 멤버가 아니거나, `shareAmount`/`ratio` 가 음수이면, **then the
  backend shall** `400 Bad Request` 를 반환한다(분담 합/비율 무결성 — 정산 무결성).
- (Unwanted behavior) **IF** 분배 대상(`participantUserIds`/`shares`)이 비어 있으면, **then the backend shall**
  `400 Bad Request` 를 반환한다(최소 1명 분담).
- (Ubiquitous, materialize) **The backend shall** 균등·커스텀·비율 **모든** 분배를 생성/수정 시 `ExpenseShare` 행으로
  **materialize** 한다(비율도 금액 환산 후 저장) — 이후 멤버십이 바뀌어도(강퇴/탈퇴) 기록 시점의 분담을 보존한다(정산이
  항상 저장된 분담 행을 읽도록 — "현재 멤버로 재계산" 금지). `splitMethod` 는 `"equal"|"custom"|"ratio"` 중 하나이며 그
  외 값은 400 이다.

### REQ-EXP-005: 경비 목록 + 요약 + 정산 조회 — 전 멤버 (Ubiquitous / Unwanted behavior 혼합)

- (Ubiquitous) **The `GET /moims/:id/expenses` response shall** 그 모임의 경비 목록(각 경비: `id`/`amount`/`category`/
  `payerUserId`/`memo`/`createdAt`/`updatedAt`/분담 행 `[{userId, shareAmount}]`)과 함께 **요약**(`total` 총지출 /
  `perPerson` 1인당(총지출 ÷ 멤버 수) / `budget` / `remaining` 남은예산(budget − total, budget 없으면 null))과 **정산**
  (`balances` 멤버별 잔액 + `transactions` 최소 거래 `[{from, to, amount, settled}]`)을 포함한다.
- (Ubiquitous, 서버 계산) **The backend shall** 정산을 서버에서 계산한다 — 멤버별 `balance = (그 멤버가 payer 인 경비
  amount 합) − (그 멤버의 ExpenseShare shareAmount 합)`. 양수=받을 사람(채권자), 음수=낼 사람(채무자). 채권/채무를
  greedy 매칭해 **최소 거래 집합**(`transactions`)을 산출한다.
- (Ubiquitous, settled 표시) **The backend shall** 각 계산된 거래에 **`settled` 플래그**를 채운다 — 그 거래의
  `(from, to, amount)` 와 일치하는 `Settlement` 마커가 존재하면 `settled=true`, 아니면 `false`. 마커는 거래를 생성하거나
  변형하지 않는다(정보성) — 거래 집합은 언제나 경비에서 재계산된다(REQ-EXP-010 의미론).
- (Ubiquitous) **The backend shall** 경비가 하나도 없는 모임에 대해 **빈 목록 + 0 요약(total 0, transactions 빈 배열)**
  을 반환한다(에러 아님).
- (Unwanted behavior) **IF** 요청 사용자가 그 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall**
  `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember` 단일 출처).

### REQ-EXP-006: 경비 삭제 — owner 전용 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 모임 **owner** 가 `DELETE /moims/:id/expenses/:expenseId` 를 호출하면, **the backend shall**
  `assertOwner` 통과 + expenseId 가 그 모임 소속인지 확인 후 그 `Expense` 를 삭제한다(종속 `ExpenseShare` 는 FK
  cascade 로 함께 삭제). 200/204 로 응답한다.
- (Unwanted behavior) **IF** 요청 사용자가 owner 가 아니면(또는 모임 미존재이면), **then the backend shall**
  `403 Forbidden`(미존재 404→403)을 반환한다(`assertOwner`).
- (Unwanted behavior) **IF** `expenseId` 가 그 모임에 속하지 않으면(또는 미존재이면), **then the backend shall**
  `404 Not Found` 를 반환한다(타-모임 자원 차단 — poll close 의 poll-moim 일관성 선례).

### REQ-EXP-007: 경비 수정 — owner 전용, 분담 재 materialize (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 모임 **owner** 가 `PATCH /moims/:id/expenses/:expenseId` 로 변경분(`amount`/`category`/
  `payerUserId`/`memo`/`splitMethod`/`participantUserIds`/`shares`)을 보내면, **the backend shall** `assertOwner` +
  expense-moim 일관성 확인 후 그 `Expense` 헤더를 갱신하고 기존 `ExpenseShare` 행을 **모두 교체(재 materialize)** 한다
  (트랜잭션 — deleteMany + 재산정 create, 단일 교체 vote 의 deleteMany+create 선례). 검증 규칙(금액/카테고리/결제자/분담
  합·비율)은 REQ-EXP-002/004 와 **동일**하다. 갱신된 경비(+분담)를 200 으로 반환한다.
- (Unwanted behavior) **IF** 요청 사용자가 owner 가 아니면(또는 모임 미존재이면) **then the backend shall** `403 Forbidden`
  (미존재 404→403)을, `expenseId` 가 그 모임에 속하지 않으면(또는 미존재이면) `404 Not Found` 를 반환한다(REQ-EXP-006 의
  인가/일관성 판정을 그대로 — 비-owner 수정·타-모임 자원 차단).
- (Ubiquitous) **The backend shall** 경비 수정으로 분담이 바뀌면 정산을 그에 맞게 재계산되도록 하고(다음 `GET` 이 재계산),
  바뀐 거래는 기존 settled 마커와 (from,to,amount) 매칭이 깨지면 미해소로 재출현하게 한다(REQ-EXP-010 의미론 — 마커 자동
  삭제 없음).

### REQ-EXP-008: realtime — expense_change 이벤트 (경비 + 정산 마커) (Event-driven)

- (Event-driven, 경비) **WHEN** `expense` 테이블에 행이 INSERT / UPDATE / DELETE 되면(경비 추가·수정·삭제), **the
  backend shall** SECURITY DEFINER DB 트리거로 같은 private 채널 `moim:{moim_id}` 에 **`expense_change`** 이벤트와 경량
  신호 `{ type:'expense_change', moimId, expenseId }` 를 `realtime.send(payload, 'expense_change', 'moim:'||moim_id, true)`
  로 방송한다(`broadcast_member_change`/`broadcast_poll_change` 미러 — `search_path=''`, private=true).
- (Event-driven, 정산 마커) **WHEN** `settlement` 테이블에 행이 INSERT / DELETE 되면(정산 완료 토글 on/off), **the
  backend shall** 같은 트리거 함수로 같은 채널에 `'expense_change'` 이벤트(`{ type:'expense_change', moimId }`)를 방송한다 —
  정산 토글도 다른 멤버의 정산 리스트를 라이브 갱신한다. `settlement` 행은 `moim_id` 를 직접 보유한다.
- **The backend shall** `realtime.messages` 멤버십 SELECT RLS("members can receive moim broadcasts", add_chat 생성)를
  **재사용**한다 — 멤버만 수신, 비멤버 RLS 차단(신규 RLS 0).
- **The backend shall** 이벤트명을 `'expense_change'` 로 두어 같은 채널의 채팅(`'INSERT'`)·poll(`'poll_change'`)·
  member(`'member_change'`)와 **교차 수신을 방지**한다(collision-avoidance — 선례 일관). expense·settlement 행 모두
  `moim_id` 를 직접 보유하므로 poll_vote 처럼 역조회할 필요가 없다(트리거 단순 — 두 테이블 트리거가 같은 함수를 공유).
- **The backend shall** 본 realtime 을 **순수 DB 트리거**로 구현한다 — NestJS 코드 변경 0(create/update/delete/정산
  토글이 row 변경으로 AFTER ROW 트리거를 발화). 트리거 SQL 은 Prisma 스키마로 표현 불가하므로 hand-authored 마이그레이션
  으로 둔다.

### REQ-EXP-009: 정산 완료 토글 — owner 전용, 영속 마커 (Event-driven / State-driven / Unwanted behavior 혼합)

- (Event-driven, 완료 표시) **WHEN** 모임 **owner** 가 한 계산된 거래에 대해 `POST /moims/:id/settlements`(body
  `{ fromUserId, toUserId, amount }`)를 호출하면, **the backend shall** `assertOwner` 통과 + 그 거래가 현재 정산 계산에
  실제 존재하는지 확인 후 `Settlement` 마커 1행을 생성한다(같은 (from,to,amount) 마커가 이미 있으면 멱등 — 중복 생성 안 함).
  생성된 마커를 201 로 반환한다.
- (Event-driven, 완료 해제) **WHEN** owner 가 `DELETE /moims/:id/settlements`(body 또는 query `{ fromUserId, toUserId,
  amount }`, 또는 `/moims/:id/settlements/:settlementId`)를 호출하면, **the backend shall** `assertOwner` 통과 후 그
  (from,to,amount) 의 settled 마커를 삭제(완료 해제)하고 200/204 로 응답한다.
- (State-driven, stale 마커) **WHILE** 어떤 settled 마커의 `(from,to,amount)` 가 현재 재계산된 거래 집합에 더 이상
  존재하지 않는 동안(경비 추가/수정/삭제로 정산이 달라짐), **the backend shall** 그 마커를 **삭제하지 않고 stale 로 남긴다** —
  재계산된 거래는 매칭 마커가 없으므로 `settled=false`(미해소)로 재출현한다(정보성 마커 — 자동 송금/취소/마커 삭제를
  일으키지 않는 안전 기본값). owner 가 새 거래를 다시 완료 표시하면 새 마커가 생긴다(과거 stale 마커는 무관).
- (Unwanted behavior) **IF** 요청 사용자가 owner 가 아니면(또는 모임 미존재이면), **then the backend shall**
  `403 Forbidden`(미존재 404→403)을 반환한다(`assertOwner`).
- (Unwanted behavior) **IF** 완료 표시 대상 거래가 현재 정산 계산에 존재하지 않으면(임의의 (from,to,amount)), **then the
  backend shall** `400 Bad Request` 를 반환한다(존재하지 않는 거래에 마커 생성 금지 — 정합성).

### REQ-EXP-010: 예산 설정 — 기존 PATCH /moims/:id 확장 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 모임 **owner** 가 기존 `PATCH /moims/:id`(SPEC-MOIM-012 maxMembers 수정 라우트)에 optional
  `budget`(Int ≥0, 또는 null 로 해제)을 포함해 호출하면, **the backend shall** `assertOwner` 통과 후 `Moim.budget` 을
  갱신한다 — `maxMembers` 와 `budget` 둘 다 optional 이며 전달된 필드만 갱신한다(부분 갱신). **전용 예산 라우트나 별도
  `setBudget` 도메인 메서드를 추가하지 않는다** — 기존 owner 전용 모임 설정 PATCH 를 확장한다.
- (Unwanted behavior) **IF** `budget` 이 정수가 아니거나 음수이면, **then the backend shall** `400 Bad Request` 를
  반환한다(`maxMembers` 검증 헬퍼 옆에 budget 검증 추가 — `null`/생략은 허용, null=예산 해제).
- (Unwanted behavior) **IF** 요청 사용자가 owner 가 아니면(또는 모임 미존재이면), **then the backend shall**
  `403 Forbidden`(미존재 404→403)을 반환한다(`assertOwner` — 기존 라우트 정책 그대로).
- (Ubiquitous) **The `GET /moims/:id/expenses` summary shall** `budget`(설정값 또는 null)과 `remaining`(budget − total,
  budget 없으면 null)을 반영한다(REQ-EXP-005).

### REQ-EXP-011: 웹 경비 UI — 전용 라우트 + FAB 기록/수정 바텀시트 + 시각화 + 정산 토글 + 라이브 갱신 (Event-driven / State-driven / Ubiquitous 혼합)

- (Ubiquitous, 진입) **The web app shall** 모임 상세(`/home/[id]`)에 **"경비" 진입 버튼**("채팅 입장" 카드 미러)을 추가해
  **전용 경비 라우트 `/moims/[id]/expenses`** 로 이동하게 한다. 이 라우트는 `moims` 그룹에 두어 `moims/layout.tsx` 의 이름
  가드를 상속하고(채팅과 동일), 3세그먼트 경로라 모바일은 native-dispatch 없이 in-WebView 로 연다.
- (State-driven, 노출) **WHILE** 사용자가 경비 화면을 보는 동안, **the web app shall** 시각화(요약 카드 / 카테고리 도넛 /
  멤버별 기여 막대 + 정산 리스트)를 전 멤버에게 렌더하고, **owner 에게만** 기록 FAB(오렌지 원형 + lucide `Plus`)·각 경비의
  수정/삭제 컨트롤·각 정산 거래의 "정산 완료" 토글을 노출한다(비-owner 면 쓰기 어포던스 숨김 — 백엔드 403 이 권위, UI 는
  defense-in-depth).
- (Event-driven, 기록/수정) **WHEN** owner 가 FAB(또는 기존 경비의 수정 버튼)로 바텀시트를 열고 금액(KRW 정수)·카테고리
  칩·결제자(기본=owner, 멤버 중 선택)·메모(선택)·분배 방식(**균등 기본 / 커스텀 금액 / 커스텀 비율**)을 채워 제출하면,
  **the web app shall** Server Action 으로 `POST`(신규) 또는 `PATCH`(수정) `/moims/:id/expenses[/:expenseId]` 를 호출하고
  성공 시 `revalidatePath("/moims/{id}/expenses")` 로 목록·요약·정산이 갱신되게 한다. 비율 입력 UI 는 멤버별 비율 숫자
  입력으로 받고 전송은 `splitMethod="ratio"` + `shares:[{userId,ratio}]`(환산은 백엔드).
- (Event-driven, 정산 토글) **WHEN** owner 가 한 정산 거래의 "정산 완료"를 토글하면, **the web app shall** Server Action
  으로 `POST`(완료) 또는 `DELETE`(해제) `/moims/:id/settlements` 를 호출하고 성공 시 재검증해 그 거래의 `settled` 표시가
  갱신되게 한다(완료 거래는 시각적으로 구분 — 예: 취소선/체크 + `text-muted-foreground`).
- (Ubiquitous, 시각화) **The web app shall** 시각화를 모바일-퍼스트 카드로 렌더한다: (A) 요약 카드 — 총지출 / 1인당 /
  남은예산(budget 설정 시만); (B) **카테고리 도넛** — 카테고리별 구성 %; (C) **멤버별 기여 막대** + **정산 리스트** —
  "{A}님이 {B}님에게 {금액}원" 형태의 최소 거래 목록(거래별 settled 표시). 차트는 번들을 가볍게 유지(경량 SVG/CSS 우선,
  §5 — 차트 라이브러리 도입은 설계 재량).
- (Event-driven, 삭제) **WHEN** owner 가 한 경비를 삭제하면, **the web app shall** Server Action 으로 `DELETE` 를 호출하고
  성공 시 재검증해 목록·요약·정산이 갱신되게 한다.
- (State-driven, 라이브) **WHILE** 사용자가 경비 화면에 머무는 동안, **the web app shall** `useExpenseChannel`(usePollChannel
  미러)로 같은 private 채널 `moim:{id}` 의 `'expense_change'` 를 구독하고 수신 시 `router.refresh()` 로 경비/요약/정산을
  서버에서 재조회한다(다른 멤버의 추가/수정/삭제/정산토글이 라이브 반영 — 경량 신호, 페이로드 내용 미사용).
- (Unwanted behavior) **IF** 기록/수정/삭제/정산토글이 백엔드 오류(400/403/404/네트워크)를 반환하면, **then the web app
  shall** 바텀시트/화면에 머무른 채 일반화된 오류를 표시하고(토큰/오류 상세 비노출 — R-A9) 재시도할 수 있게 한다.
- (Ubiquitous, 디자인) **The web app shall** 경비 UI 를 Meetup 디자인 시스템(모임 상세가 쓰는 오렌지 시맨틱 토큰 —
  `bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`/`bg-secondary`)과 lucide
  아이콘으로 렌더하며 login/onboarding 의 blue 흐름 토큰을 사용하지 않는다. 바텀시트는 backdrop 오버레이
  (members-section.tsx `ConfirmDialog` 의 `fixed inset-0 z-50 bg-black/50` 스타일 재사용 가능).

---

## 3. 델타 마커 (Delta Markers)

본 SPEC은 모임 도메인에 **경비 하위 도메인**을 신규 추가한다(greenfield 안에서 brownfield 인프라 재사용).
파일·라인은 작성 시점(2026-06-24) verified 기준. 구현 시 재확인한다.

### [EXISTING] (재사용 — 변경 없음 / 확인만)

- `apps/backend/src/moim/moim.service.ts` `assertMember`(:69-77)/`assertOwner`(:83-90)/`updateMaxMembers`(:53-63,
  budget 수용으로 확장 [MODIFY])/`setStartsAt`(:139-144)/`setLocation`(:149-154) — **인가·쓰기 단일 출처 재사용**. 경비
  서비스가 create/update/delete/정산토글 첫 줄에서 assertOwner, list 첫 줄에서 assertMember 를 호출한다(재구현 금지).
- `apps/backend/src/poll/poll.controller.ts` — 중첩 라우트(`@Controller('moims/:id/polls')`)·per-route 가드·
  `requireNonEmpty`/`normalizeOptions` 류 검증 헬퍼·상태코드 관례의 **참조 패턴**(ExpenseController 가 미러).
- `apps/backend/src/poll/poll.service.ts` `aggregatePolls`(:250-310) — 서버 집계 패턴의 **참조**(ExpenseService 정산
  계산이 미러). `vote` 의 단일 교체(deleteMany+create, :151-154) — 경비 수정의 ExpenseShare 재 materialize 참조.
- `apps/web/app/(main)/home/[id]/page.tsx` — Server Component + `isOwner` 판정(:93). "채팅 입장" 링크(:117-128)를
  미러해 **"경비" 진입 버튼**(`/moims/{id}/expenses`)을 추가하는 지점([MODIFY]). 경비 데이터는 이 페이지가 아니라 전용
  라우트가 fetch 한다(인라인 섹션 아님).
- `apps/web/app/moims/[id]/chat/page.tsx` + `apps/web/app/moims/layout.tsx`(이름 가드) — **전용 라우트 호스트 선례**.
  경비 라우트 `app/moims/[id]/expenses/` 가 이 그룹/가드 구조를 미러한다(풀스크린, `(main)` 셸 밖).
- `apps/mobile/lib/route-map-core.ts` `detailRouteForUrl`(:112) — 3세그먼트 `/moims/{id}/expenses` 를 채팅과 동일하게
  **native-dispatch 대상에서 제외**(detail-push 안 함 → in-WebView). 신규 로직 없음 — 회귀 vitest 확인만([MODIFY]).
- `apps/web/lib/poll/usePollChannel.ts`·`apps/web/lib/moim/useMemberChannel.ts` — realtime 구독 훅 **참조 패턴**
  (useExpenseChannel 이 미러).
- `apps/web/app/(main)/home/[id]/poll-actions.ts`·`member-actions.ts` — Server Action 패턴(`requireToken`/
  `revalidatePath`/일반화 오류) **참조**(expense-actions.ts 가 미러).
- realtime RLS — `add_chat` 의 `realtime.messages` 멤버십 SELECT RLS **재사용**(신규 RLS 0, 확인만).
- `apps/mobile/**`(route-map-core 회귀 외) — **모바일 네이티브 코드 무변경**(경비 UI 는 in-WebView 웹 라우트, 신규 탭/
  컴포넌트/deep-link 없음 — 채팅과 동형).

### [ADD] (신규)

- `apps/backend/prisma/schema.prisma` — `Expense`(+`updatedAt`) + `ExpenseShare` + `Settlement` 모델 신규 + `Moim.budget
  Int?` 컬럼 추가 + `Moim.expenses Expense[]`/`Moim.settlements Settlement[]` 역참조.
- `apps/backend/prisma/migrations/<ts>_add_expense/migration.sql` — `Moim.budget` 컬럼 + `expense`/`expense_share`/
  `settlement` 테이블 CREATE(FK cascade, 인덱스). additive.
- `apps/backend/prisma/migrations/<ts>_add_expense_realtime_broadcast/migration.sql` — hand-authored 트리거
  `broadcast_expense_change()`(SECURITY DEFINER, `search_path=''`, `realtime.send(..., 'expense_change',
  'moim:'||moim_id, true)`) + `expense_broadcast`(AFTER INSERT OR UPDATE OR DELETE ON expense) + `settlement_broadcast`
  (AFTER INSERT OR DELETE ON settlement, 같은 함수). `add_poll_realtime_broadcast` 미러.
- `apps/backend/src/expense/` — `expense.module.ts` / `expense.controller.ts`(`@Controller('moims/:id/expenses')` 의
  POST/GET/PATCH/DELETE + `@Controller('moims/:id/settlements')` 의 POST/DELETE, 또는 한 컨트롤러 두 경로) /
  `expense.service.ts`(create/update/delete/list+summary+settlement(settled 매칭)/toggleSettlement — assertOwner/
  assertMember 사용, 정산 계산 + 비율 환산) / `dto/`(create-expense / update-expense / expense-response(+summary/
  settlement transaction[+settled]) / create-settlement DTO). MoimModule import.
- `packages/api-client` — `schema.d.ts` 재생성(경비/정산 DTO 반영) + `index.ts` 타입 별칭(`CreateExpenseRequest`/
  `UpdateExpenseRequest`/`ExpenseListResponse`/`CreateSettlementRequest` 등).
- `apps/web/lib/moim/expenses.ts` — path-param 구체-경로 헬퍼(`listExpenses`/`createExpense`/`updateExpense`/
  `deleteExpense`/`markSettlement`/`unmarkSettlement`) + web 미러 타입(`ExpenseWithShares`/`ExpenseSummary`/
  `SettlementTransaction`(+settled)). polls.ts 미러.
- `apps/web/lib/moim/useExpenseChannel.ts` — `'expense_change'` 구독 훅(usePollChannel 미러).
- `apps/web/app/moims/[id]/expenses/page.tsx` — **전용 경비 라우트**(Server Component, `moims/layout.tsx` 이름 가드 상속).
  세션 access_token 으로 `GET /moims/:id` + `/members` + `/expenses` fetch → Client 섬에 plain object 전달.
- `apps/web/app/moims/[id]/expenses/expense-screen.tsx`(또는 분할) — Client 섬: 요약 카드 / 카테고리 도넛 / 멤버별 기여
  막대 + 정산 리스트(settled 토글) / owner FAB + 기록·수정 바텀시트(균등/금액/비율) + 삭제 컨트롤 / `useExpenseChannel`.
- `apps/web/app/moims/[id]/expenses/expense-actions.ts` — Server Action(`createExpenseAction`/`updateExpenseAction`/
  `deleteExpenseAction`/`markSettlementAction`/`unmarkSettlementAction`). poll-actions.ts 미러.

### [MODIFY] (수정)

- `apps/backend/src/moim/moim.controller.ts` `PATCH /moims/:id`(:171) — optional `budget`(Int ≥0/null) 수용으로 확장
  (`maxMembers` 와 함께 부분 갱신, owner 인가는 기존 `assertOwner` 그대로). budget 검증을 maxMembers 검증 헬퍼(:250) 옆에
  추가. 전용 예산 라우트·`setBudget` 신설 안 함.
- `apps/backend/src/moim/moim.service.ts` `updateMaxMembers` → `updateMoimSettings`(또는 budget 인자 추가) — maxMembers/
  budget 부분 갱신을 한 메서드로(owner 인가 단일 출처 유지).
- `apps/backend/src/moim/dto/update-max-members.dto.ts` — optional `budget` 필드 추가(또는 update-moim.dto 로 일반화).
- `apps/web/app/(main)/home/[id]/page.tsx` — "채팅 입장" 카드 미러로 **"경비" 진입 버튼**(`/moims/{id}/expenses` 링크)
  추가. 경비 데이터 fetch 는 하지 않는다(전용 라우트가 담당).
- `apps/web/lib/moim/api.ts`(또는 moim 설정 헬퍼) — 예산 수정용 `PATCH /moims/:id` 호출에 budget 포함(maxMembers 헬퍼 확장).
- `apps/mobile/lib/route-map-core.test.ts`(vitest) — `/moims/{id}/expenses` 가 채팅처럼 detail-push 안 됨(회귀) 케이스
  확인. 신규 라우팅 로직 없음.
- `apps/backend/src/app.module.ts`(또는 모듈 집합) — `ExpenseModule` 등록.

### [BREAK] / [REMOVE]

- 없음 — 순수 additive(신규 테이블/컬럼/라우트/파일). 기존 테이블·라우트·DTO·필드 제거 0. 기존 소비처 무파손.

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC(MVP)에서 **구현하지 않는다**(향후 후속 SPEC 후보):

- **영수증 사진 + OCR** — 사진 첨부·이미지 저장·OCR 금액/항목 자동 추출은 MVP 제외(v2). 금액·카테고리는 수기 입력.
- **기간/추세 막대 차트** — 시간축(일/주/월) 지출 추이 막대/라인 차트는 제외(v2). MVP 시각화는 총량·카테고리 구성·멤버
  기여·정산뿐.
- **예산 대비 실적 차트** — budget vs actual 게이지/막대 비교 차트는 제외(v2). MVP 는 "남은 예산" 숫자 카드만.
- **Sankey(자금 흐름도)** — 결제자→카테고리→분담 흐름 Sankey 다이어그램은 제외(v3).
- **CSV / 내역 내보내기** — 경비 내역 CSV·엑셀·PDF 내보내기는 제외(v2/v3).
- **카카오 1/N 송금 연동 / 모임통장 연동** — 정산 리스트에서 실제 송금(카카오페이 등)·은행 모임통장 연동·자동 입출금
  반영은 제외(v3). MVP 정산은 "누가 누구에게 얼마"의 계산·표시 + **정산 완료 수동 토글(영속 마커)**까지만이며, 실제 돈
  이동·자동 송금 확인은 제외한다. settled 마커는 정보성이고 경비 변경 시 자동으로 삭제/재송금하지 않는다(§5 의미론).
- **다중 통화 / 환율** — 통화는 **KRW 정수 고정**(소수점 없음 — amount/shareAmount/budget 모두 정수 원 단위). 다른
  통화·환율 변환은 제외.
- **경비 카테고리 커스터마이즈** — 카테고리는 고정 프리셋(식비/교통/숙박/입장/준비물/기타). 사용자 정의 카테고리·자유
  입력은 제외(v2 후보).
- **반복/정기 경비, 할부, 부분 환불** — 제외.
- **알림/리마인더** — "정산하세요" push/이메일 리마인더는 제외(v2 — SPEC-CHAT-002 push 인프라 위 후속 후보).
- **모바일 신규 네이티브 코드** — 경비 UI 는 전용 웹 라우트 `/moims/[id]/expenses` 가 소유하고 모바일 WebView 안에서
  렌더된다(채팅 `/moims/[id]/chat` 과 동형 — 3세그먼트라 native-dispatch 안 됨). expo-router 네이티브 라우트/탭/컴포넌트·
  deep-link 추가 없음(route-map-core 회귀 vitest 확인만).
- **정산 완료 자동화 / 송금 상태 머신** — 정산 토글은 단순 on/off 영속 마커다(REQ-EXP-009). 거래별 부분 정산·정산 이력
  타임라인·"누가 언제 송금했는지" 추적·자동 송금 연동·정산 알림은 제외(v2/v3). stale 마커 자동 정리(garbage-collect)도
  제외 — stale 마커는 남되 매칭 안 되어 무해하다(§5).
- **realtime 부분 패칭 / presence / optimistic UI** — `expense_change` 는 경량 신호 → `router.refresh()` 재조회뿐
  (poll/member 동일 철학). per-expense diff 패칭·낙관적 업데이트·typing/presence 는 제외.

---

## 5. 설계 노트 (Design Notes)

### 데이터 — Expense + ExpenseShare(분담 materialize) + Settlement + Moim.budget

- `Expense` 는 한 지출의 헤더다(누가 얼마를 어떤 카테고리로 결제했나 + 메모 + 수정 시각 `updatedAt`). 분담은
  `ExpenseShare`(경비당 멤버당 1행, 복합 PK `(expenseId, userId)`)로 분리해 "이 지출을 누가 얼마씩 부담하나"를 행으로 고정한다.
- **균등·커스텀(금액)·비율 분배 모두 생성/수정 시 분담 행을 materialize** 한다("현재 멤버로 그때그때 재계산"하지 않는다).
  이유: 멤버가 나중에 강퇴/탈퇴하면 "현재 멤버 균등"은 기록 시점과 달라져 정산이 틀어진다 — 기록 시점 분담을 행으로 박아
  두면 정산은 항상 저장된 분담을 합산하면 된다(PollVote 가 그 시점 표를 고정하는 것과 동형). `splitMethod` 는 "생성/수정
  시 분배 규칙"일 뿐 저장 형태는 셋 다 동일(`shareAmount` 금액만 — 정산 코드 단순). 수정 시에는 단일 교체 vote 처럼
  기존 ExpenseShare 를 deleteMany 후 재산정 create 한다(트랜잭션).
- **비율 분배는 별도 컬럼 없이 금액으로 환산**한다 — `ratio` 합으로 `amount` 를 안분해 정수 `shareAmount` 를 만들고, 안분
  나머지(원 단위)는 균등과 동일한 결정적 규칙으로 배분해 **분담 합 = amount** 를 보장한다. 비율 원값은 영속하지 않는다
  (정산은 항상 금액만 읽음 — 비율 재계산 경로 없음, 데이터 단순).
- 균등 나머지 처리: `amount` 가 참가자 수로 나누어떨어지지 않으면 원 단위 나머지를 결정적으로 배분(앞선 참가자에게 1원씩)
  해 **분담 합 = amount** 를 보장한다(반올림 누락으로 1~수원이 새는 것 방지). 비율 안분도 동일 규칙.
- `Moim.budget Int?` 는 maxMembers/startsAt/location 의 additive nullable 선례를 따른다 — 예산은 선택(미설정=null,
  "남은 예산" 카드 미표시).

### 정산 완료 토글 — Settlement 영속 마커(정보성 스냅샷)

- `Settlement`(`moimId`/`fromUserId`/`toUserId`/`amount`/`settledBy`/`settledAt`, surrogate `id` PK)는 "이 거래는
  실제로 정산됐다"는 owner 의 수동 표시를 영속한다. **정산 거래 자체는 항상 경비에서 재계산**되고, 마커는 거래를 만들거나
  바꾸지 않는다 — `GET` 응답이 각 계산된 거래에 `(from,to,amount)` 가 일치하는 마커 존재 여부로 `settled` 플래그만 채운다.
- **의미론(채택, §HISTORY v0.2.0)**: settled 마커는 정보성이다. 경비가 추가/수정/삭제돼 정산이 달라지면(거래 금액/짝
  변동), 기존 마커는 **삭제하지 않고 stale 로 남긴다** — 재계산된 거래는 매칭 마커가 없어 `settled=false`(미해소)로
  재출현한다. 이는 안전 기본값이다: 경비 변동이 과거 "정산 완료"를 자동으로 지우거나(데이터 손실) 재송금을 일으키지(부작용)
  않는다. owner 가 새 거래를 다시 완료 표시하면 새 마커가 생기고, 과거 stale 마커는 어떤 거래와도 매칭되지 않아 무해하다
  (stale 마커 자동 정리는 §4 제외 — 남아도 표시에 영향 없음). 멱등: 같은 (from,to,amount) 마커가 이미 있으면 재생성 안 함.
- surrogate id 를 PK 로 두는 이유: 같은 (from,to,amount) 거래가 경비 변동으로 사라졌다 재출현하면 과거 stale 마커와 새
  완료 마커가 공존할 수 있다 — surrogate id 가 둘을 구별해 (필요 시) 개별 삭제·정리를 가능케 한다(복합 PK 면 충돌).

### 정산 — 서버 계산 balance + greedy 최소 거래

- 멤버별 `balance = (그 멤버가 payerUserId 인 경비들의 amount 합) − (그 멤버의 ExpenseShare shareAmount 합)`.
  양수 = 받을 돈(채권자), 음수 = 낼 돈(채무자). 전 멤버 balance 합 = 0(분담 합 = amount 보장이 이를 담보).
- 최소 거래: 채권자/채무자를 분리하고 greedy 로 가장 큰 채무자 ↔ 가장 큰 채권자를 매칭해 작은 쪽을 소거하며
  `{from, to, amount}` 리스트를 만든다(Tricount식). 각 거래에 settled 마커 매칭 여부(`settled`)를 덧붙인다. 이 계산은
  `aggregatePolls` 가 myVotes 를 서버에서 계산하는 것과 같은 철학 — **서버 = 단일 진실 출처, 클라는 표시만**.
- 정산은 `GET /moims/:id/expenses` 응답에 `summary` + `settlement`(거래별 settled 포함)로 **함께** 싣는다(단일 fetch —
  listPolls 가 집계 결과를 한 번에 반환하는 선례, 클라 단일 fetch). 별도 `GET .../settlement` 라우트는 두지 않는다.

### 전용 라우트 — /moims/[id]/expenses (채팅 미러, 모바일 무변경)

- 경비 화면은 모임 상세의 인라인 섹션이 아니라 **전용 라우트 `app/moims/[id]/expenses/page.tsx`** 다 — 채팅
  (`app/moims/[id]/chat/page.tsx`)과 동일 구조. `moims` 그룹에 속해 `moims/layout.tsx` 의 `requireNamedSession()` 이름
  가드를 상속하고(`(main)` 셸 밖 풀스크린), 모임 상세에서 "채팅 입장"을 미러한 "경비" 버튼으로 진입한다.
- 모바일 영향 0: `route-map-core.detailRouteForUrl` 은 `/home/{id}`(2세그먼트)만 detail-push 하고 `/moims/{id}/chat`·
  `/moims/{id}/expenses`(3세그먼트)는 native-dispatch 대상에서 제외한다(WebView 내부 이동). 따라서 경비 라우트 추가는
  네이티브 코드를 요구하지 않으며 vitest 회귀로 "expenses 가 detail-push 안 됨"만 고정한다.

### 예산 — 기존 PATCH /moims/:id 확장(전용 라우트/메서드 없음)

- 예산 설정은 SPEC-MOIM-012 의 owner 전용 `PATCH /moims/:id`(현재 maxMembers 수정)에 optional `budget` 을 더해 처리한다.
  `setStartsAt`/`setLocation` 같은 전용 도메인 쓰기 메서드나 전용 예산 라우트를 신설하지 않는다 — `updateMaxMembers` 를
  maxMembers/budget 부분 갱신 메서드로 확장(owner 인가 단일 출처 유지)하고 컨트롤러가 budget 정수·음수 검증(400)을 더한다.

### realtime — expense_change(같은 채널, 신규 RLS 0)

- `broadcast_member_change`/`broadcast_poll_change` 트리거를 그대로 미러하되 이벤트명을 `'expense_change'` 로 둔다
  (같은 채널 공유 → 교차 수신 방지 필수). expense·settlement 행 모두 `moim_id` 직접 보유 → poll_vote 처럼 역조회 불필요.
  **`expense` 행 트리거**(INSERT/UPDATE/DELETE = 추가/수정/삭제)와 **`settlement` 행 트리거**(INSERT/DELETE = 정산 토글
  on/off)가 같은 함수 `broadcast_expense_change()` 를 공유한다. expense_share 별도 트리거는 불필요(share 는 같은
  트랜잭션에서 expense 와 함께 변경되거나 share-only 갱신 경로가 없음).
- 웹은 `useExpenseChannel` 로 구독해 수신 시 `router.refresh()` → 전용 라우트 Server Component(`expenses/page.tsx` →
  listExpenses) 재실행 → 요약/정산(+settled)이 라이브 재계산. NestJS 코드 변경 0.

### 웹 — 전용 라우트 + FAB + 바텀시트 + 대시보드 + 정산 토글

- 진입: 모임 상세(`/home/[id]`)의 "경비" 버튼("채팅 입장" 카드 미러) → `/moims/[id]/expenses`.
- 기록/수정은 owner 전용 FAB(오렌지 원형, lucide `Plus`, 화면 하단 고정 후보) + 경비별 수정 버튼 → 바텀시트
  (`fixed inset-x-0 bottom-0` + backdrop). 폼: 금액(숫자 입력, KRW 정수), 카테고리 칩(선택 버튼 그룹), 결제자(멤버
  select, 기본=owner), 메모(선택 textarea), 분배 — **3-way 선택(균등 / 커스텀 금액 / 커스텀 비율)**: 균등=참가자 멤버
  체크박스 / 금액=멤버별 금액 입력(합=amount) / 비율=멤버별 비율 숫자 입력(백엔드가 금액 환산). Server Action 제출
  (`POST` 신규 / `PATCH` 수정).
- 시각화: 요약 카드 3개(총지출/1인당/남은예산) → 카테고리 도넛(경량 SVG `<circle>` stroke-dasharray 또는 conic-gradient,
  번들 가볍게 — 차트 라이브러리는 도입 시 트리쉐이크 가능한 것으로 한정) → 멤버별 기여 막대(poll 득표 막대 CSS 패턴
  재사용) + 정산 리스트("{nickname}님 → {nickname}님 {금액}원").
- 정산 토글: 각 거래에 owner 전용 "정산 완료" 토글(체크박스/버튼) — on=`POST /settlements`, off=`DELETE /settlements`.
  완료 거래는 `text-muted-foreground`+취소선/체크로 시각 구분. 경비 변동으로 미해소 재출현하면 다시 미완료로 표시된다.
- 디자인: Meetup 오렌지 시맨틱 토큰·lucide. blue 미사용. 모바일-퍼스트.

---

## 6. 수용 기준 (Acceptance Criteria — Given-When-Then)

> 백엔드는 jest 로 검증한다. 웹은 테스트 하니스가 없어 build/lint/tsc + 추론 + iOS 시뮬레이터 라이브 확인으로
> 검증한다(웹 자동 테스트 미작성). 디바이스 종단 검증(§7) 전까지 status 는 in-progress.

### AC-1: owner 균등 경비 기록 ← REQ-EXP-002 / REQ-EXP-004

- **Given** owner 와 멤버 3명(총 3명)인 모임에서
- **When** owner 가 `amount=30000, category="식비", payerUserId=owner, splitMethod="equal"`(참가자 생략=전 멤버)로
  `POST /moims/:id/expenses` 를 호출하면
- **Then** 201 + Expense 1행 + ExpenseShare 3행(각 10000)이 저장되고 분담 합 = 30000 이다.
- **And When** `amount=10000` 을 3명 균등 분배하면 **Then** 분담은 결정적 나머지 배분(예: 3334/3333/3333)으로 합 = 10000 이다.

### AC-2: owner 커스텀(금액) 분배 기록 + 합 검증 ← REQ-EXP-004

- **Given** owner 모임에서 **When** owner 가 `splitMethod="custom", shares=[{A,20000},{B,10000}], amount=30000` 으로
  기록하면 **Then** 201 + 그대로 저장된다(A=20000, B=10000).
- **And When** `shares` 합(25000)이 `amount`(30000)와 불일치하면 **Then** 400 이며 아무것도 저장되지 않는다.
- **And When** `shares` 의 어떤 userId 가 비멤버이거나 shareAmount 가 음수이면 **Then** 400 이다.

### AC-2b: owner 비율(ratio) 분배 → 금액 환산 저장 ← REQ-EXP-004

- **Given** owner 모임(A/B/C)에서 **When** owner 가 `splitMethod="ratio", shares=[{A,2},{B,1},{C,1}], amount=40000` 으로
  기록하면 **Then** 201 + ExpenseShare 가 금액으로 환산 저장된다(A=20000, B=10000, C=10000) — 분담 합 = 40000.
- **And When** 비율 안분이 나누어떨어지지 않으면(예: `ratio=[1,1,1], amount=10000`) **Then** 결정적 나머지 배분으로
  합 = 10000(예: 3334/3333/3333)이며 ExpenseShare 에는 비율이 아니라 환산 금액만 저장된다.
- **And When** 비율 합이 0 이하이거나 ratio 가 음수이면 **Then** 400.

### AC-3: 비-owner 기록 차단 ← REQ-EXP-002

- **Given** 모임의 일반 멤버(비-owner)가 **When** `POST /moims/:id/expenses` 를 호출하면 **Then** 403(`assertOwner`)이며
  경비가 생성되지 않는다.
- **And When** 존재하지 않는 모임이면 **Then** 404→403(미존재도 owner 판정 전 차단)이다.

### AC-4: 검증 — 금액(KRW 정수)/카테고리/결제자/splitMethod ← REQ-EXP-002 / REQ-EXP-003 / REQ-EXP-004

- **Given** owner 모임에서 **When** `amount` 가 0/음수/소수(비정수)이면 **Then** 400(통화 = KRW 정수, 소수점 없음).
- **And When** `category` 가 프리셋(식비/교통/숙박/입장/준비물/기타) 외이면 **Then** 400.
- **And When** `payerUserId` 가 그 모임의 멤버가 아니면 **Then** 400.
- **And When** `splitMethod` 가 `"equal"|"custom"|"ratio"` 외이면 **Then** 400.

### AC-5: 전 멤버 목록 + 요약 + 정산 조회 ← REQ-EXP-005

- **Given** A가 30000(균등 3명), B가 9000(균등 3명)을 결제·기록한 모임에서
- **When** 멤버가 `GET /moims/:id/expenses` 를 호출하면
- **Then** `total=39000`, `perPerson=13000`(39000÷3), 경비 2건 + 각 분담 행이 반환되고 **정산**은 balance(A=+26000,
  B=−4000... 분담 차감 후) 기반 최소 거래 리스트(각 거래에 `settled` 플래그)를 포함하며 전 멤버 balance 합 = 0 이다.
- **And When** 경비가 하나도 없으면 **Then** 빈 목록 + total 0 + transactions 빈 배열(에러 아님).
- **And When** settled 마커가 없으면 **Then** 모든 거래 `settled=false`.

### AC-6: 비멤버 조회 차단 ← REQ-EXP-005

- **Given** 그 모임의 멤버가 아닌 사용자가 **When** `GET /moims/:id/expenses` 를 호출하면 **Then** 403(`assertMember`,
  미존재 404→403)이며 경비/정산이 노출되지 않는다.

### AC-7: owner 삭제 + cascade ← REQ-EXP-006

- **Given** owner 모임의 경비 1건(분담 3행)에서 **When** owner 가 `DELETE /moims/:id/expenses/:expenseId` 를 호출하면
  **Then** 200/204 + Expense 및 ExpenseShare 3행이 함께 삭제되고 요약/정산이 재계산된다.
- **And When** 비-owner 가 삭제하면 **Then** 403. **And When** 타-모임 expenseId 면 **Then** 404.

### AC-8: 예산 — PATCH /moims/:id 확장 + 남은 예산 ← REQ-EXP-010 / REQ-EXP-005

- **Given** owner 가 기존 `PATCH /moims/:id` 에 `budget=100000` 을 보내 설정하고 총지출이 40000 인 모임에서 **When**
  멤버가 `GET /moims/:id/expenses` 를 조회하면 **Then** `budget=100000`, `remaining=60000` 이다.
- **And When** budget 이 미설정(null)이면 **Then** `remaining=null`(웹은 "남은 예산" 카드를 표시하지 않는다).
- **And When** owner 가 `PATCH /moims/:id` 에 `maxMembers` 만 보내면 **Then** budget 은 불변(부분 갱신)이고, `budget` 만
  보내면 maxMembers 불변이다(SPEC-MOIM-012 maxMembers 회귀 보존).
- **And When** `budget` 이 음수/비정수이면 **Then** 400. **And When** 비-owner 가 PATCH 하면 **Then** 403.

### AC-9: realtime — expense_change 라이브 갱신(경비 + 정산 토글) ← REQ-EXP-008 / REQ-EXP-011

- **Given** 두 멤버가 같은 경비 화면을 열고 있는 상태에서 **When** owner 가 경비를 추가/수정/삭제하면 **Then** 다른 멤버
  화면이 `expense_change` 수신 → `router.refresh()` 로 경비/요약/정산이 라이브 갱신된다.
- **And When** owner 가 정산 완료를 토글(on/off)하면 **Then** `settlement` 트리거가 `expense_change` 를 방송해 다른 멤버
  정산 리스트의 settled 표시가 라이브 갱신된다.
- **And Given** 비멤버는 `realtime.messages` RLS 로 `moim:{id}` 채널 메시지를 수신하지 못한다(신규 RLS 0, 멤버십 RLS 재사용).
- **And When** 다른 채널 이벤트(채팅 'INSERT'/poll 'poll_change'/member 'member_change')가 와도 경비 구독은 반응하지
  않는다(이벤트명 분리 — 교차 수신 방지).

### AC-10: 웹 UI — 전용 라우트 진입 + owner FAB/수정/삭제/토글 vs 멤버 읽기 전용 ← REQ-EXP-011

- **Given** 멤버가 모임 상세(`/home/[id]`)를 보면 **Then** "경비" 진입 버튼("채팅 입장" 미러)이 보이고, 누르면
  `/moims/[id]/expenses` 전용 화면으로 이동한다(모바일은 in-WebView — 네이티브 탭 dispatch 없음).
- **And Given** owner 가 경비 화면을 보면 **Then** 기록 FAB(오렌지 + lucide Plus)·경비별 수정/삭제 컨트롤·거래별 "정산
  완료" 토글이 보인다.
- **And Given** 일반 멤버가 보면 **Then** FAB·수정·삭제·정산 토글은 숨고 요약 카드/카테고리 도넛/멤버 기여 막대/정산
  리스트(settled 표시 읽기 전용)만 보인다.
- **And** 모든 경비 UI 는 Meetup 오렌지 시맨틱 토큰 + lucide 로 렌더되고 blue 흐름 토큰을 쓰지 않는다.

### AC-11: owner 경비 수정 → 분담 재 materialize ← REQ-EXP-007

- **Given** owner 모임의 균등 경비 1건(amount=30000, A/B/C 각 10000)에서 **When** owner 가 `PATCH /moims/:id/expenses/
  :expenseId` 로 `amount=30000, splitMethod="custom", shares=[{A,30000}]`(A 단독 부담)으로 수정하면 **Then** 200 +
  기존 ExpenseShare 3행이 삭제되고 A=30000 한 행으로 교체되며 정산이 재계산된다.
- **And When** 수정 검증(금액/카테고리/결제자/분담 합·비율)이 실패하면 **Then** 400 이고 기존 경비/분담은 불변이다.
- **And When** 비-owner 가 수정하면 **Then** 403. **And When** 타-모임 expenseId 면 **Then** 404.

### AC-12: 정산 완료 토글 + 영속 + stale 재출현 ← REQ-EXP-009 / REQ-EXP-005

- **Given** 정산 거래 "A→B 4000" 이 계산된 모임에서 **When** owner 가 `POST /moims/:id/settlements {A,B,4000}` 를
  호출하면 **Then** 201 + Settlement 마커 저장 + 이후 `GET` 의 그 거래 `settled=true`.
- **And When** owner 가 `DELETE /moims/:id/settlements {A,B,4000}` 로 해제하면 **Then** 마커 삭제 + 그 거래 `settled=false`.
- **And When** 같은 마커를 다시 `POST` 하면 **Then** 멱등(중복 행 없음).
- **And When** 존재하지 않는 거래 (임의 from,to,amount)를 완료 표시하면 **Then** 400.
- **And When** settled 후 경비가 바뀌어 그 거래 금액/짝이 달라지면 **Then** 재계산된 거래는 `settled=false`(미해소 재출현)
  이고 과거 마커는 삭제되지 않고 stale 로 남아 어떤 거래와도 매칭되지 않는다(자동 송금/삭제 없음 — §5 의미론).
- **And When** 비-owner 가 토글하면 **Then** 403.

### 엣지 케이스

- 결제자 = 분담 비참가자(자기 분담 0, 결제만): balance 가 큰 양수 → 정산에서 받을 사람. (← REQ-EXP-004/005)
- 1인 모임(owner 만): 균등 분배 참가자 1명 → 분담 = amount, balance = 0, transactions 빈 배열. (← REQ-EXP-004/005)
- 균등/비율 나머지: amount 가 N 으로(또는 비율로) 안 나누어떨어질 때 분담 합 = amount 보장(원 단위 누락 0). (← REQ-EXP-004)
- 경비 삭제 후 정산 재계산: 삭제된 경비의 분담이 balance 에서 제거되어 전 멤버 balance 합 = 0 유지. (← REQ-EXP-006/005)
- 경비 수정 후 정산 재계산: 분담 교체로 balance 가 바뀌고, settled 마커가 (from,to,amount) 매칭이 깨지면 미해소 재출현.
  (← REQ-EXP-007/009/005)
- 멤버 강퇴 후 기존 경비 분담 보존: materialize 된 ExpenseShare 는 강퇴와 무관하게 남아 정산에 반영(현재 멤버 재계산
  금지). (← REQ-EXP-004)
- stale settled 마커: 완료 표시한 거래가 경비 변동으로 사라지면 마커는 남되 어떤 재계산 거래와도 매칭 안 됨(표시 무영향,
  자동 삭제·송금 없음). (← REQ-EXP-009)
- 비율 합 0 / 음수 비율 / 커스텀 합 불일치: 400(분담 무결성). (← REQ-EXP-004)

### Definition of Done

- [ ] backend jest: AC-1~12 + 엣지(균등/비율 나머지·1인·삭제 재계산·비참가 결제자·분담 합 검증·수정 재 materialize·정산
      토글 영속·stale 재출현·budget 부분 갱신·비-owner 403·비멤버 403·타-모임 404)
- [ ] backend LIVE 종단(실 Supabase): `expense_change` 트리거 발화(경비 INSERT/UPDATE/DELETE + settlement INSERT/DELETE)
      + 멤버 수신 + 비멤버 RLS 미수신 + 이벤트명 분리(poll-realtime.live.mts 미러) — AC-9
- [ ] `tsc` 0 error (backend + web + api-client) — 경비/정산 DTO·미러 타입·Server Action
- [ ] web lint 0 + `nx run web:build` 0 (전용 라우트·바텀시트(균등/금액/비율)·도넛·정산 리스트·토글 컴파일)
- [ ] mobile tsc / vitest / `expo export` 회귀 0 — `route-map-core` vitest 에 `/moims/{id}/expenses` 가 detail-push 안 됨
      (채팅 동형) 케이스 포함, 네이티브 코드 무변경
- [ ] 마이그레이션 비파괴 additive (`migrate status` clean — `Moim.budget` + expense/expense_share/settlement 테이블 +
      트리거만, 기존 무변경)
- [ ] **디바이스 종단 검증(PENDING)**: iOS 시뮬레이터 모임 상세 → "경비" 버튼 → `/moims/[id]/expenses` in-WebView 진입 →
      owner FAB 로 경비 기록(균등/커스텀 금액/비율)·수정·삭제 → 요약/도넛/정산 라이브 표시 → 정산 완료 토글 영속 → 다른
      멤버 화면 `expense_change` 라이브 갱신. 그 전까지 status `in-progress`.

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + iOS 시뮬레이터 라이브 확인으로 수행하며 웹 자동
> 테스트는 작성하지 않는다(web-no-test-harness). 백엔드는 jest(경비 CRUD + 분배 + 정산 + 인가) + LIVE(realtime). api-client
> 는 tsc. 모바일은 본 SPEC에서 무변경(회귀 0 확인용 tsc/vitest/expo export).

- backend jest 통과 — 경비 기록(균등/커스텀 금액/비율, 분담 materialize)·수정(분담 재 materialize)·검증(금액 KRW 정수/
  카테고리/결제자/splitMethod/분담 합·비율 400)·목록+요약+정산 서버 계산(balance 합 0·최소 거래·settled 매칭)·정산 토글
  영속+stale 재출현·삭제 cascade·예산 PATCH 부분 갱신(maxMembers 회귀)+남은예산·인가(비-owner 쓰기 403, 비멤버 조회 403,
  타-모임 404) + 엣지(균등/비율 나머지·1인·비참가 결제자·삭제 재계산).
- backend LIVE 종단(`expense-realtime.live.mts`, 실 Supabase) — `expense_change` 트리거 발화(경비 INSERT/UPDATE/DELETE +
  settlement INSERT/DELETE) + 멤버 수신 + 비멤버 RLS 미수신 + 채팅/poll/member 와 이벤트명 분리(교차 수신 방지).
  poll-realtime.live.mts 미러.
- `tsc` 0 error (backend + web + api-client — 경비/정산 DTO + web 미러 타입 + Server Action + 도넛/정산/토글 컴포넌트).
- web lint 0 + `nx run web:build` 0 (전용 라우트 `app/moims/[id]/expenses/`).
- mobile tsc / vitest / `expo export` 회귀 0 (네이티브 무변경) — `route-map-core` vitest 에 `/moims/{id}/expenses` 가
  채팅처럼 detail-push 되지 않음(in-WebView) 회귀 케이스 추가.
- 마이그레이션 **비파괴 additive** — `Moim.budget` 컬럼 + `expense`/`expense_share`/`settlement` 테이블 +
  `broadcast_expense_change` 트리거(expense + settlement 두 트리거, 같은 함수). 기존 테이블/컬럼/PK/트리거 무변경. 트리거
  SQL 은 hand-authored(migrate diff 금지 — db execute/resolve/status). `.moai/project/db/` 문서화.
- **디바이스 종단 검증**: 자동 게이트 통과만으로 완료되지 않는다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated).
  iOS 시뮬레이터에서 §6 DoD 디바이스 항목이 라이브 검증되어야 status 가 `completed` 로 전환된다. 그 전까지 `in-progress`.
- 상세 수용 기준은 §6 참조.

---

## 8. 확정된 결정 (Resolved Decisions)

> 최초 draft(v0.1.0)에서 오케스트레이터가 사용자와 확정하도록 남긴 6개 결정이 v0.2.0 에서 모두 확정되어 본문(§1~7)에
> 반영됐다. 아래는 결정 내역과 본문 반영 위치다. 추가 미해결 결정은 없다.

1. **분배 모델 깊이** — **확정: 둘 다 MVP**. 균등(N빵 기본) + 커스텀(특정 멤버 / 멤버별 금액 / 멤버별 비율). ExpenseShare 가
   세 방식 모두 기록 시점에 분담을 materialize 하고 비율은 금액으로 환산해 저장한다. → REQ-EXP-004, §5 데이터 노트, AC-1/2/2b.
2. **경비 위치** — **확정: 전용 라우트 `/moims/[id]/expenses`**(인라인 섹션 아님). 채팅(`/moims/[id]/chat`) 미러 — `moims`
   그룹·`moims/layout.tsx` 이름 가드 상속, 3세그먼트라 모바일 detail-push 제외(in-WebView, 네이티브 코드 0). 모임 상세에
   "경비" 진입 버튼 추가. → REQ-EXP-011, §1 아키텍처, §3 [ADD]/[MODIFY], §5 전용 라우트 노트, AC-10.
3. **정산 완료 토글** — **확정: MVP 포함**(영속). 신규 `Settlement` 마커(`moimId`/`fromUserId`/`toUserId`/`amount`/
   `settledBy`/`settledAt`) + owner 토글 라우트(`POST`/`DELETE /moims/:id/settlements`). **의미론**: 마커는 정보성
   스냅샷 — 정산은 항상 경비에서 재계산하고 (from,to,amount) 매칭으로 settled 표시. 경비 변경으로 거래가 달라지면 미해소
   재출현(마커는 stale 로 남되 자동 삭제/재송금 없음 — 안전 기본값). → REQ-EXP-001(Settlement)/005(settled)/009, §5 정산
   토글 노트, AC-5/12, REQ-EXP-008(정산 realtime).
4. **통화** — **확정: KRW 정수**(소수점 없음). amount/shareAmount/budget 모두 정수 원 단위. → REQ-EXP-002/004,
   §4(다중 통화 제외), AC-4.
5. **경비 수정** — **확정: MVP 포함**. `PATCH /moims/:id/expenses/:expenseId`(owner), ExpenseShare 재 materialize
   (deleteMany + 재산정 create). → REQ-EXP-007, §3 [ADD], AC-11.
6. **예산 설정 엔드포인트** — **확정: 기존 `PATCH /moims/:id` 확장**(전용 라우트 없음). optional `budget` 을 maxMembers
   수정 라우트에 더해 부분 갱신. `updateMaxMembers` → maxMembers/budget 갱신 메서드로 확장(전용 `setBudget` 미신설).
   → REQ-EXP-010, §3 [MODIFY], §5 예산 노트, AC-8.

전체 규모: **EARS 11개 모듈(REQ-EXP-001~011) + AC 13개(AC-1·2·2b·3~12)**. (v0.1.0 은 9 REQ + AC 10개였다.)
