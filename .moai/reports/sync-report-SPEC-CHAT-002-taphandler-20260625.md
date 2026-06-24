# Sync Report — SPEC-CHAT-002 알림 탭 핸들러 통합

- **일자**: 2026-06-25
- **대상 SPEC**: SPEC-CHAT-002 (FCM 백그라운드 푸시)
- **브랜치**: feature/SPEC-MOBILE-004
- **세션 커밋 범위(핵심)**: `19754e3`(탭 핸들러), `c3aa95b`(migrate-prod CI), `afc5692`(.gitignore), `6cb7672`+`5d1800e`+`0e53496`(CI 그린 복구), `774c614`(eas env)
- **문서 언어**: 한국어(코드/식별자 영어)

## 1. SPEC 상태 결정

- **SPEC-CHAT-002 = `in-progress` 유지** (변경 없음).
- **버전 bump**: v0.3.0 → **v0.4.0** (HISTORY 항목 추가).
- **근거**: 이번 세션에서 알림 탭 핸들러(R-PUSH-007)를 앱 진입점에 배선하고 iOS 시뮬레이터에서 포그라운드 배너 표시 + 딥링크 라우팅을 검증했으나, **AC-5(실기기 FCM 종단 수신)는 여전히 미완료**(device-gated). iOS 시뮬레이터는 실 FCM 을 받을 수 없고(APNs↔FCM 토큰 불일치), `FIREBASE_CREDENTIALS` 가 prod Render env 에 미추가되어 prod 푸시는 no-op. `mobile-spec-device-gated` 관례에 따라 자동 게이트 + 시뮬레이터 검증만으로 completed 처리하지 않는다.

### 검증됨(verified) vs device-gated(미검증)

| 구분 | 항목 |
|------|------|
| **검증됨** | (a) 포그라운드 푸시 배너 표시(`setNotificationHandler`) (b) 딥링크 `moyura:///home/{id}?target=chat` → "모임 채팅" 렌더(탭 핸들러 `router.push` 목적지 검증) (c) 디바이스 토큰 등록/해제 API + push jest 34건 green |
| **device-gated(미검증)** | 실기기 FCM 종단(end-to-end) 백그라운드 수신 + 실 알림 탭. iOS 시뮬레이터 불가(Android 이 깨끗한 경로). prod 푸시는 `FIREBASE_CREDENTIALS` prod env 추가 전까지 no-op |

## 2. 변경된 문서

| 파일 | 변경 내용 |
|------|-----------|
| `.moai/specs/SPEC-CHAT-002/spec.md` | frontmatter v0.3.0→v0.4.0, updated 2026-06-25. HISTORY 에 탭 핸들러 통합 + 시뮬레이터 검증 + iOS FCM-토큰 갭 항목 추가. status in-progress 유지 |
| `CHANGELOG.md` | `[Unreleased]` 에 4개 항목 추가 — 알림 탭→채팅 이동(Added), migrate-prod CI(Added), gitignore+eas env(Added), CI 그린 복구(Fixed) |
| `.moai/project/structure.md` | push 모듈에 탭 핸들러 배선 메모, expense 백엔드 모듈 트리 추가, moim 멤버 관리 라우트(강퇴/양도/cap) 추가, 신규 3 마이그레이션, expense 웹 라우트, migrate-prod.yml 워크플로우 |
| `.moai/project/tech.md` | CI 섹션에 migrate-prod.yml 추가, SPEC-CHAT-002 라인 v0.4.0 탭 핸들러 갱신, IMPLEMENTED 표에 SPEC-MOIM-EXPENSE-001 행 추가 |
| `.moai/project/product.md` | 스테일 사실 수정 — "SPEC-ENV-SETUP-001 한 건만 존재"·"mobile 은 기본 스캐폴드, WebView 미도입" 의 거짓 진술을 현 구현(모임 도메인 + 하이브리드 구현됨)으로 정정. TBD 비전 구조는 보존 |

## 3. 프로젝트 문서 업데이트 vs 유지 결정

- **업데이트함**:
  - tech.md/structure.md 에 **expense 도메인**(backend `expense/` + web expense 라우트 + 2 마이그레이션) — prior-session 머지(`4c2fe33`)였으나 문서 미반영이었음. 현 코드베이스 기준 갭 해소.
  - **멤버 관리 확장**(강퇴/소유권 양도/정원 maxMembers + 멤버 realtime, 마이그레이션 `20260624000000`) — 문서 미반영 갭 해소.
  - **migrate-prod.yml** — 신규 CI 워크플로우 미반영 갭 해소.
  - **알림 탭 핸들러 배선** — structure.md push 모듈 메모.
  - product.md 의 명백한 스테일 사실 2건 정정.
- **유지함(이미 반영)**:
  - tech.md 의 **firebase-admin/FCM 스택**(데이터/백엔드 섹션에 5회 언급, env.validation·graceful no-op·라이브 검증까지 기술됨) — 추가 변경 불필요.
  - **Render/Vercel/EAS 배포 토폴로지** — 이미 정확히 기술됨.
  - product.md 의 **상위 하위 도메인/페르소나/value proposition TBD** — 의도된 미확정 비전 구조이므로 보존.

## 4. 발견했으나 수정하지 않은 드리프트(사용자 인지용)

1. **SPEC-MOIM-EXPENSE-001 SPEC 문서의 status**: 본 sync 는 SPEC-CHAT-002 대상이므로 expense SPEC 의 status 플립은 다루지 않았다. expense 기능은 코드/테스트가 존재하고 CI green 이나, 별도 sync 로 expense SPEC 의 검증 상태(특히 device-gated 여부)를 확정할 것을 권한다.
2. **멤버 cap/강퇴/양도·realtime 의 SPEC 출처 미상**: 코드(커밋 `c0e72f1`/`af493fc`)와 마이그레이션은 존재하나 어떤 SPEC-ID 에 귀속되는지 문서에서 추적되지 않았다(structure.md/tech.md 에 "SPEC 멤버 cap+realtime" 으로 일반 표기). 해당 기능의 SPEC 문서가 있다면 ID 를 연결할 것을 권한다.
3. **prod FCM 미배선**: `FIREBASE_CREDENTIALS` 가 prod Render env 에 미추가 — prod 푸시 no-op. SPEC-CHAT-002 잔여 게이트(§8)에 기록되어 있으나, 실 배포 운영 측 액션 아이템으로 남는다.
4. **CHANGELOG `[Unreleased]` 누적**: expense MVP·멤버 realtime/cap·kick/transfer 등 prior-session 기능이 CHANGELOG 에 개별 항목으로 기재되었는지 미확인(이번 세션 4건만 추가). 릴리스 전 `[Unreleased]` 정합성 일괄 점검 권장.
5. **세션 git 범위 불일치**: 작업 지시의 범위 `93de6cb..774c614` 는 CI-그린/eas 커밋만 포함하고, 탭 핸들러(`19754e3`)·migrate-prod(`c3aa95b`)·gitignore(`afc5692`)는 그 직전 커밋(merge `93de6cb` 의 부모 측)에 있었다. 모두 master 에 이미 커밋된 상태이므로 문서 반영에는 문제 없음.

🗿 MoAI <email@mo.ai.kr>
