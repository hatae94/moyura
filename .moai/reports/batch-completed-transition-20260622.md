# device-gated SPEC 일괄 completed 전환 리포트 (2026-06-22)

## 1. 개요

모바일 WebView 디바이스 검증을 게이트로 `in-progress` 에 묶여 있던 모임/투표 SPEC 6개를
2026-06-22 검증 근거 충족에 따라 `completed` 로 일괄 전환했다.

| SPEC | 제목 | 전 status | 후 status | 버전 |
|------|------|-----------|-----------|------|
| SPEC-MOIM-004 | 모임 생성 UI 기능화 + 이벤트 일정/장소 필드 | in-progress | **completed** | 0.2.0 → 0.3.0 |
| SPEC-MOIM-005 | 모임 투표(poll) — 생성·단일 투표·결과 집계 | in-progress | **completed** | 0.2.0 → 0.3.0 |
| SPEC-MOIM-006 | 투표 다중 선택(multi-select) | in-progress | **completed** | 0.2.0 → 0.3.0 |
| SPEC-MOIM-007 | 투표 마감(deadline + 수동 마감) | in-progress | **completed** | 0.2.0 → 0.3.0 |
| SPEC-MOIM-008 | 일정 투표 자동 확정 → Moim.startsAt | in-progress | **completed** | 0.2.0 → 0.3.0 |
| SPEC-MOIM-010 | 장소 투표 자동 확정 → Moim.location | in-progress | **completed** | 0.2.0 → 0.3.0 |

## 2. 제외: SPEC-MOIM-009 (in-progress 유지)

SPEC-MOIM-009(투표 결과 실시간 갱신 — Supabase Realtime broadcast)는 **전환 대상에서 제외**한다.
백엔드+Realtime 라이브 E2E(`poll-realtime.live.mts` 7/7 PASS)는 통과했으나, **모바일 iOS WebView 셸에서
cross-surface 실시간 전파(한 멤버의 투표 → 다른 멤버 WebView 화면 라이브 갱신)가 디바이스에서 미관찰**이다.
실시간 전파는 정적 렌더 검증으로 대체할 수 없는 고유 게이트이므로 `in-progress` 를 유지한다(정직성 원칙,
프로젝트 메모리 `mobile-spec-device-gated`).

## 3. 이미 completed (전환 불필요)

- SPEC-MOIM-003 (모임 상세 + 홈 실 데이터) — completed, v0.3.0 (AC-3 디바이스 검증 2026-06-18)
- SPEC-MOIM-011 (초대 링크 생성 UI + moyura://invite 딥링크) — completed, v0.3.0 (Maestro 검증 36143ba)
- SPEC-CHAT-001 (모임 채팅 코어) — completed, v0.3.1

## 4. 검증 근거 (표면별)

### 4.1 Maestro 모바일 in-WebView 검증 (iPhone 16 시뮬레이터, 2026-06-22)

Maestro 2.3.0(번들 idb 드라이버 — macOS Accessibility 권한 불필요)로 핸즈프리 구동:

- 네이티브 셸 콜드스타트 부팅 + 로그인(하태용)
- 홈 → 모임 상세 **네이티브 push** → 웹 상세 in-WebView 렌더
- 모임 상세 안에서 **전 poll 섹션 WebView 렌더** 확인(일반/날짜/장소/마감 배지 포함)
- **finalize 결과가 모임 헤더(일정 startsAt / 장소 location)에 반영**되어 표시됨
- 초대 수락(invite-accept) WebView 상호작용(닉네임 입력 + 참여)
- CHAT-001 채팅 화면 렌더

도구 한계(앱 결함 아님): WebView 내부의 poll-option 버튼 직접 탭은 a11y resolution + Next.js dev badge
overlay 로 불안정. **투표 자체의 동작은 데스크톱 멀티탭 + live.mts 로 실증**했으므로 검증 공백 없음.

### 4.2 데스크톱 멀티탭 브라우저 워크스루 (chrome-devtools, 2026-06-22)

2개 격리 세션(앨리스=생성자/방장, 밥=멤버)으로 실제 2-멤버 워크스루:

- 투표 생성 / 단일 투표 / 재투표 교체(총 1표 불변) — MOIM-005
- 다중 선택 토글(여러 선택지 동시 강조·50/50·총 N표·토글 off) / 단일 교체 회귀 0 — MOIM-006
- 미래 마감 생성 · 생성자 수동 마감 → "마감됨" 배지 + 비활성 + 결과 유지 · 마감 후 409 차단 · 재-close 멱등 — MOIM-007
- 날짜 투표 마감 → 모임 헤더 startsAt 확정 갱신 · 동점 skip — MOIM-008
- 장소 투표 마감 → 모임 헤더 location 확정 갱신 · 동점 skip — MOIM-010
- 모임 생성 폼(일정/장소) → 제출 → 상세 → 일정/장소 표시 — MOIM-004
- per-user myVotes 정확 · 생성자 전용 마감 · 3-way 종류 선택(일반/날짜/장소)

### 4.3 라이브 통합 E2E (실 Supabase 스택)

- `apps/backend/test/poll-finalize.live.mts` — 15/15 PASS (날짜 투표 자동 확정, 2026-06-21)
- `apps/backend/test/poll-place-finalize.live.mts` — 13/13 PASS (장소 투표 자동 확정, 2026-06-22)
- 단일 승자 → startsAt/location 설정 + finalized 필드 / 동점 → skip + 불변 / 무표 → skip /
  일반 투표 close → finalize 없음 / 비생성자 close → 403 / 미지 kind → 400

### 4.4 자동 게이트

- backend jest 308/308 (장소 투표 신규 + finalize + 일반/날짜/마감 회귀)
- tsc 0 (backend/web/api-client/mobile), web lint/build 0
- mobile vitest 215/215 (회귀 0 — 모바일 무변경)
- prisma migrate status clean

## 5. 변경 파일

| 파일 | 변경 |
|------|------|
| `.moai/specs/SPEC-MOIM-{004,005,006,007,008,010}/spec.md` | frontmatter status `in-progress` → `completed`, version 0.2.0 → 0.3.0, updated 2026-06-22, HISTORY v0.3.0 엔트리 추가 |
| `.moai/specs/SPEC-MOIM-{004,005,006,007,008,010}/acceptance.md` | device-gated AC `[ ]` → `[x]` + 2026-06-22 검증 근거 기재, footer device-gate 해소 노트 |
| `.moai/project/tech.md` | 6개 SPEC 블록쿼트 status 토큰(`completed`/v0.3.0) + IMPLEMENTED 테이블(MOIM-004/005/006/007/008, MOIM-010은 테이블 행 없음) + device-gated 검증 완료 노트 |
| `CHANGELOG.md` | `### Changed` 통합 전환 엔트리 + 6개 SPEC 인라인 status 배지 `in-progress` → `completed` |
| `.moai/reports/batch-completed-transition-20260622.md` | 본 리포트 |

SPEC-MOIM-009 관련 문서는 **무변경**(in-progress 유지). 소스 코드(`apps/**`) 무변경(문서 전용 전환).

## 6. 최종 상태 표 (모임/채팅 SPEC)

| SPEC | status |
|------|--------|
| SPEC-MOIM-003 | completed |
| SPEC-MOIM-004 | completed |
| SPEC-MOIM-005 | completed |
| SPEC-MOIM-006 | completed |
| SPEC-MOIM-007 | completed |
| SPEC-MOIM-008 | completed |
| SPEC-MOIM-009 | **in-progress** (모바일 실시간 cross-surface 미관찰) |
| SPEC-MOIM-010 | completed |
| SPEC-MOIM-011 | completed |
| SPEC-CHAT-001 | completed |
| SPEC-CHAT-002 | in-progress (실기기 FCM device-gated) |
