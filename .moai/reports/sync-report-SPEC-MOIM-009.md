# Sync Report — SPEC-MOIM-009

생성일: 2026-06-22
브랜치: feature/SPEC-MOBILE-004
커밋: a48b1af
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-009/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0), HISTORY v0.2.0 항목 추가(구현 요약 + 자동 게이트 + Realtime 라이브 E2E 결과 + device-gated 이유) |
| `.moai/specs/SPEC-MOIM-009/acceptance.md` | 수정 | DoD 체크박스 업데이트 — 자동 게이트 + LIVE 스크립트 검증 항목 ✓ 처리 + "라이브 검증 2026-06-22" 주석; 디바이스 종단 검증 항목 미체크 + "PENDING device-gated" 주석 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-009 항목 추가(비파괴 트리거 마이그레이션, 채널·RLS 재사용, collision-avoidance, 백엔드 무변경, 웹 실시간 구독, LIVE 스크립트, device-gated 미완료, SPEC-MOIM-008 후속 명시) |
| `.moai/project/db/migrations.md` | 수정 | Applied Migrations에 `20260622000000_add_poll_realtime_broadcast` 행 추가; Pending Migrations에 동일 항목 추가; Rollback Notes에 20260622000000 롤백 절차 추가(DROP TRIGGER + DROP FUNCTION) |
| `.moai/project/db/schema.md` | 수정 | last_synced_at + spec 헤더 갱신; `Triggers & Realtime` 신규 섹션 추가 — CHAT-001 broadcast 트리거 표 + SPEC-MOIM-009 broadcast 트리거 표(broadcast_poll_change 함수/poll_broadcast/poll_vote_broadcast 트리거/이벤트명/채널/RLS 재사용/멱등 가드/페이로드/검증 항목 문서화) |
| `.moai/project/structure.md` | 수정 | backend `prisma/migrations/` 설명에 20260622000000_add_poll_realtime_broadcast 추가; `test/` 설명에 poll-realtime.live.mts 추가; `lib/` 설명에 poll/usePollChannel.ts 신규 항목 추가; `polls-section.tsx` 설명에 실시간 구독(accessToken prop+usePollChannel) 반영; `page.tsx` 설명에 accessToken prop 전달 반영 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-009 요약 추가(in-progress, 커밋, 게이트 결과, Realtime 라이브 E2E, device-gated); 구현됨 vs 계획됨 표에 SPEC-MOIM-009 in-progress 행 신규 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-009.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`

**전환 근거**: 구현이 완료되어 자동 게이트 전부 GREEN이고 Realtime 라이브 E2E(poll-realtime.live.mts, 실 Supabase 스택) 7/7 PASS가 확인되었으나, (1) 브라우저 다중 클라이언트 UI 워크스루(탭 2개 동시 열어 한쪽 투표/생성/마감 → 다른 쪽 라이브 갱신 확인)가 moyura-verify 세션 access_token 만료로 미완료이고, (2) 모바일 WebView 셸에서 실시간 구독이 동작하는지(in-WebView Supabase Realtime WebSocket + router.refresh)가 iOS 시뮬레이터에서 미검증 상태이므로, 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 `in-progress` 유지.

`completed` 전환 조건: (a) 브라우저 다중 클라이언트 UI 워크스루 — 재로그인 후 탭 2개에서 같은 모임 상세(`/home/{id}`)를 열고, 한쪽 탭에서 투표/생성/마감 → 다른 쪽 탭이 리로드 없이 라이브 갱신(새 표/새 투표/마감됨 배지) 및 날짜 투표 finalize 시 모임 헤더 일정(startsAt) 라이브 확정 + 각 멤버의 myVotes 정확성 확인. (b) iOS 시뮬레이터 dev build에서 동일 플로우가 WebView 안에서 라이브 검증되어야 함(WebView 내 WebSocket이 차단 없이 동작하고 router.refresh가 WebView 안에서 재렌더를 일으키는지 확인). 두 조건 충족 시 `completed` 전환.

---

## 3. 구현 범위 및 설계 결정

### 비파괴 순수 트리거 마이그레이션 (핵심 구현 결정)

`20260622000000_add_poll_realtime_broadcast/migration.sql`은 테이블·컬럼·PK·FK·인덱스를 한 줄도 변경하지 않는 순수 트리거 추가다. 이는 MOIM-005~008의 비파괴 패턴을 이어받되, 스키마 컬럼이 아닌 plpgsql 함수 + 트리거만 additive하게 추가한다(add_chat 선례).

```sql
CREATE OR REPLACE FUNCTION broadcast_poll_change()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_moim_id text;
  v_poll_id text;
BEGIN
  IF TG_TABLE_NAME = 'poll' THEN
    v_poll_id := NEW.id;
    v_moim_id := NEW.moim_id;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_poll_id := OLD.poll_id;
    ELSE
      v_poll_id := NEW.poll_id;
    END IF;
    SELECT p.moim_id INTO v_moim_id FROM public.poll p WHERE p.id = v_poll_id;
  END IF;
  IF v_moim_id IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('moimId', v_moim_id, 'pollId', v_poll_id),
      'poll_change', 'moim:' || v_moim_id, true
    );
  END IF;
  RETURN NULL;
END;
$$;
```

`SECURITY DEFINER` + `SET search_path = ''` — add_chat의 `broadcast_chat_message` 보안 패턴 동일. search_path 하이재킹 차단, 정의자(postgres) 권한으로 realtime.send 호출.

### CHAT-001 채널·RLS 재사용 — 신규 채널/RLS 없음

poll broadcast도 `realtime.messages` 를 거쳐 저장되므로 add_chat 이 만든 멤버십 RLS(`"members can receive moim broadcasts"`)가 자동 적용된다. 비멤버가 `moim:{id}` private 채널을 구독해도 `realtime.messages` SELECT가 거부되어 `'poll_change'` 시그널을 받지 못한다. 이는 CHAT-001의 비멤버 차단(REQ-CHAT-004)을 poll에도 free로 상속하는 핵심 설계 결정이다.

### 이벤트명 `'poll_change'` — collision-avoidance

채팅 구독은 `.on('broadcast', { event: 'INSERT' })` 로 INSERT 이벤트만 필터링한다. 같은 `moim:{id}` private 채널에서 poll이 `'INSERT'`를 쓰면 채팅 구독자가 poll 시그널을 메시지로 오인하고, poll 구독자가 채팅 INSERT를 투표 변경으로 오인한다. 구별 이벤트명 `'poll_change'`로 supabase-js의 이벤트 필터가 두 구독자를 완전히 분리한다.

### poll_vote moimId 해소 — poll 조회

`chat_message` 테이블은 `moim_id` 컬럼을 직접 보유하지만 `poll_vote`는 그렇지 않다. 트리거 함수가 `poll_id(NEW/OLD)` → `SELECT moim_id FROM public.poll WHERE id = poll_id`로 moimId를 해소한다. poll이 이미 삭제된 경우 `v_moim_id IS NULL` 조건에서 방송을 생략한다(안전 fallback).

### 경량 시그널 페이로드 — 집계 미포함

broadcast 페이로드는 `{moimId, pollId}` 최소 신호뿐이다. `voteCount`·`myVotes`·옵션 내용을 싣지 않는 이유: myVotes는 구독자별로 다르므로(자신의 표만) 단일 broadcast에 담을 수 없다. 클라이언트가 `router.refresh()` → Server Component 재실행 → `listPolls` 서버 재조회로 각자의 myVotes 포함 집계 뷰를 얻는다(서버 = 단일 진실 출처).

### 웹 usePollChannel — useChatChannel 미러

`apps/web/lib/poll/usePollChannel.ts`는 `useChatChannel.ts`의 구독·setAuth·private 채널·removeChannel 패턴을 그대로 미러하되 이벤트명만 `'poll_change'`로 한다. `PollsSection`은 `accessToken` prop을 추가로 받아 usePollChannel에 주입하고, `'poll_change'` 수신 시 `router.refresh()`를 호출한다. `page.tsx`는 이미 보유하는 `session.access_token`을 `accessToken` prop으로 한 줄 더 전달한다.

---

## 4. 자동 게이트 + 라이브 검증 결과

### 자동 게이트

| 게이트 | 결과 |
|--------|------|
| backend jest | 301/301 (코드 변경 없음 — 기존 poll/chat 회귀 포함; 별도 커밋 eda85a2에서 pre-existing 시간 의존 테스트 수정, 본 SPEC 범위 외) |
| backend tsc | 0 error (NestJS 코드 무변경) |
| web tsc | 0 error (accessToken prop + usePollChannel + router.refresh 타입 확인) |
| api-client tsc | 0 error (응답 shape 변경 없음) |
| mobile tsc | 0 error |
| mobile vitest | 215/215 (회귀 0 — 모바일 무변경) |
| web lint (`nx run web:lint`) | 0 error |
| web build (`nx run web:build`) | 0 error |
| prisma migrate status | clean (12 마이그레이션 — `20260622000000_add_poll_realtime_broadcast` 포함, 테이블/컬럼/PK/FK 무변경) |

### Realtime 라이브 E2E (poll-realtime.live.mts, 실 Supabase 스택, 2026-06-22)

`apps/backend/test/poll-realtime.live.mts` — chat.live.mts/poll-finalize.live.mts 패턴 미러, 실 Supabase Realtime + DB + RLS 대상:

| 시나리오 | 결과 |
|----------|------|
| 멤버 A·B가 `moim:{id}` private 채널 구독 후 A가 poll 생성(poll INSERT) | A·B 둘 다 `'poll_change'` broadcast 수신 확인 |
| 멤버 A가 poll_vote INSERT(투표) | A·B 둘 다 `'poll_change'` broadcast 수신 확인 |
| 멤버 A가 poll UPDATE(마감) | A·B 둘 다 `'poll_change'` broadcast 수신 확인 |
| 비멤버 S가 동일 채널 구독 시 | `realtime.messages` RLS 차단 — `'poll_change'` 미수신 확인 |
| broadcast 페이로드 검증 | `{moimId, pollId}` 경량 신호 확인(집계/표 정보 없음) |
| 채팅 구독자(`'INSERT'`)와 poll 구독자(`'poll_change'`) 교차 수신 | 각자 해당 이벤트만 수신(collision-avoidance 확인) |
| 총계 | **7/7 PASS** |

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: poll broadcast 트리거 + 비파괴 마이그레이션 | broadcast_poll_change 함수 + poll_broadcast/poll_vote_broadcast 트리거 additive 추가, 테이블/컬럼/PK/FK 무변경, migrate clean | prisma migrate clean + poll-realtime.live.mts | **PASS** |
| AC-2: 채널 + RLS 재사용 — 멤버 수신 / 비멤버 차단 | CHAT-001 `moim:{id}` private 채널 + `realtime.messages` 멤버십 RLS 재사용, 멤버 A·B 수신, 비멤버 S RLS 차단, 신규 채널/RLS 0 | poll-realtime.live.mts | **PASS** |
| AC-3: 백엔드 NestJS 무변경 | NestJS 코드 0줄 변경, 기존 create/vote/close가 AFTER ROW 트리거 발화, 응답/DTO/인가 보존 | jest 301/301 회귀 0 + tsc 0 | **PASS** |
| AC-4: 웹 PollsSection 실시간 구독 + router.refresh | accessToken prop + usePollChannel + `'poll_change'` 구독 + router.refresh + 토큰 가드 + removeChannel | web tsc 0 + lint 0 + build 0 (브라우저 다중 클라이언트 워크스루 미완료) | **PASS (자동 부분) / PENDING — 브라우저 재로그인 대기** |
| AC-5: page.tsx accessToken 전달 | `accessToken={session.access_token}` 추가, 기존 props/fetch/가드 보존 | web tsc 0 + build 0 | **PASS** |
| AC-6: 모바일 무변경 — WebView 가 구독 | 신규 네이티브 코드 0, mobile tsc/vitest/expo export 회귀 0 | mobile vitest 215/215(회귀 0) | **PASS (자동 부분) / PENDING — iOS WebView 실시간 검증 대기** |
| AC-7: 품질 게이트 + LIVE 종단 증명 (자동 부분) | 자동 게이트 전부 GREEN + poll-realtime.live.mts 7/7 PASS | 자동 게이트 + 라이브 E2E | **PASS (자동 + LIVE 부분)** |
| AC-7: 디바이스 종단 검증 | 브라우저 다중 클라이언트 + 모바일 WebView 라이브 갱신 확인 | 브라우저 재로그인 대기 + iOS 시뮬레이터 검증 대기 | **PENDING — device-gated** |

---

## 6. 미완료 — 브라우저 다중 클라이언트 워크스루 + 모바일 WebView 검증

### 브라우저 다중 클라이언트 UI 워크스루 (재로그인 후)

moyura-verify 계정 세션 access_token이 sync 세션 중 만료. 재로그인 후 수행:

1. 계정 A/B로 각각 로그인 → 같은 모임 상세(`/home/{id}`)를 탭 2개에서 열기
2. 탭 A에서 투표 만들기 → 탭 B에서 리로드 없이 새 투표 등장 확인
3. 탭 B에서 투표(옵션 선택) → 탭 A에서 득표 수 라이브 갱신 확인
4. 탭 A에서 "마감하기" → 탭 B에서 "마감됨" 배지 + 비활성 컨트롤 라이브 반영 확인
5. 날짜 투표 finalize 시나리오 → 탭 B에서 모임 헤더 일정(startsAt) 라이브 확정 갱신 확인
6. 각 탭에서 자신의 myVotes(투표한 옵션 강조)가 올바르게 보이는지 확인

### 모바일 iOS WebView 검증 (in-app, iOS 시뮬레이터)

1. 앱 시작 → 로그인 → 홈 탭 → 모임 카드 탭 → 상세(`/home/{id}`) in-WebView 로드
2. 브라우저 탭과 WebView를 동시에 같은 모임 상세에서 열고, 한쪽에서 투표/생성/마감
3. 다른 쪽(WebView 또는 브라우저)이 리로드 없이 라이브 갱신되는지 확인
4. 날짜 투표 finalize → 양쪽 모임 헤더 일정(startsAt) 라이브 확정 + myVotes 정확성 확인

**핵심 검증 포인트**: WebView 안에서 Supabase Realtime WebSocket이 차단 없이 동작하고, usePollChannel이 `'poll_change'` 이벤트를 수신해 `router.refresh()`를 호출하며, Next.js App Router의 Server Component 재실행이 WebView 내 네비게이션 컨텍스트에서 올바르게 렌더링되는지(SPEC-MOIM-005~008과 동일한 WebView+Server Action 검증 관점에 실시간 구독 경로가 추가됨).

---

## 7. DB 변경 내역 (트리거 추가 — 테이블 무변경)

### 신규 트리거 + 함수 (순수 추가 — 기존 테이블/컬럼 무변경)

| 항목 | 내용 |
|------|------|
| **신규 함수** | `broadcast_poll_change()` plpgsql SECURITY DEFINER 함수 |
| **신규 트리거** | `poll_broadcast` — AFTER INSERT OR UPDATE ON `poll` |
| **신규 트리거** | `poll_vote_broadcast` — AFTER INSERT OR DELETE ON `poll_vote` |
| **기존 테이블 변경** | 없음(poll/poll_option/poll_vote/moim 컬럼·PK·FK·인덱스 무변경) |

### 신규 마이그레이션

| 파일명 | 적용일 | 내용 |
|--------|--------|------|
| `20260622000000_add_poll_realtime_broadcast` | 2026-06-22 | broadcast_poll_change 함수 + poll_broadcast(AFTER INSERT OR UPDATE ON poll) + poll_vote_broadcast(AFTER INSERT OR DELETE ON poll_vote). SQL: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS(멱등) + CREATE TRIGGER. 비파괴 패턴(hand-authored migration.sql → db execute → migrate resolve --applied → migrate status clean). 테이블/컬럼/PK/FK/인덱스 무변경(row 손실 0). |

변경된 DB 문서: `.moai/project/db/schema.md`(Triggers & Realtime 섹션 신규), `.moai/project/db/migrations.md`

---

## 8. SPEC-MOIM-008 후속 관계

SPEC-MOIM-009는 SPEC-MOIM-008(일정 투표 자동 확정)의 직속 후속이다. MOIM-008이 만든 날짜 투표 + finalize → `Moim.startsAt` 확정을 **다른 멤버에게 실시간으로 전파**하는 것이 본 SPEC의 핵심 사용 사례 중 하나다. MOIM-009의 `'poll_change'` 시그널을 받은 모든 멤버의 `router.refresh()`가 `getMoim`도 재조회하므로, 날짜 투표 finalize로 인한 `moim.startsAt` 변경이 모든 멤버의 모임 헤더에 라이브로 반영된다(moim 테이블에 별도 트리거 없이 — poll UPDATE 트리거 하나로 충분).

| 도메인 | SPEC | status |
|--------|------|--------|
| 단일 선택 투표 인프라 | SPEC-MOIM-005 | in-progress (device-gated) |
| 다중 선택(multi-select) 확장 | SPEC-MOIM-006 | in-progress (device-gated) |
| 마감(deadline + 수동 마감) + 투표 차단 | SPEC-MOIM-007 | in-progress (device-gated) |
| 날짜 투표 자동 확정(kind + optionDate + finalize) | SPEC-MOIM-008 | in-progress (device-gated) |
| **투표 결과 실시간 갱신(CHAT-001 Realtime 재사용)** | **SPEC-MOIM-009** | **in-progress (device-gated)** |
