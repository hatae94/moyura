# Acceptance — SPEC-SAFETY-001 (신고·차단 UGC 모더레이션)

> REQ↔AC 매핑은 spec.md 각 REQ의 "AC:" 라인 참조. 모든 AC는 1개 이상의 REQ를 커버한다. 백엔드는 jest(fake Prisma) 검증, apps/web은 빌드/린트 검증만(웹 테스트 하네스 부재).

## Given/When/Then 시나리오

### 모듈 1 — 신고 (REQ-RPT)

#### AC-RPT-1 (REQ-RPT-001) — 신고 저장
- **Given** 모임 M에 멤버 A(신고자), B(대상)가 있고 B가 작성한 채팅 메시지 msg1이 존재
- **When** A가 `content_type=chat_message`, `content_id=msg1`, `reason="스팸"`으로 신고
- **Then** `report` 행이 `reporterId=A, targetUserId=B, moimId=M, reason="스팸", contentType=chat_message, contentId="<msg1>"`로 저장된다

#### AC-RPT-2 (REQ-RPT-002) — 신고자 측 즉시 숨김 (block 미생성)
- **Given** A가 B의 콘텐츠를 신고 접수 완료
- **When** A가 이후 목록/히스토리를 조회
- **Then** `getHiddenUserIds(A)`에 B가 포함되어 A 화면에서 B의 UGC가 숨겨진다. **단 `block` 행은 생성되지 않는다**(report 소스 숨김만) — `listBlocks(A)`에는 B가 나타나지 않음

#### AC-RPT-3 (REQ-RPT-003) — 신고 후 차단 유도 (수락/거부)
- **Given** A가 신고를 성공적으로 접수해 "이 멤버를 차단할까요?" 유도가 노출됨
- **When** (수락) A가 유도를 수락 → `POST /blocks { blockedUserId: B }`
- **Then** 이 시점에 비로소 `block(A→B)` 행 생성, 이후 `listBlocks(A)`에 B 포함
- **When** (거부) A가 유도를 거부
- **Then** `block` 행 미생성, 그러나 report 기반 숨김은 유지됨(getHiddenUserIds(A)에 B 잔존)

#### AC-RPT-4 (REQ-RPT-004, REQ-RPT-005) — 복합 PK 신고 거부 + 참조 타입
- **Given** 모임 M
- **When** A가 `content_type=poll_vote`(또는 expense_share / schedule_slot)로 신고 시도
- **Then** 400 거부 — 단일 PK 4종(chat_message/poll/expense/settlement_request)만 수용. `content_id`는 TEXT 저장이며 chat_message 필터 시에만 BigInt 캐스팅

### 모듈 2 — 차단 (REQ-BLK)

#### AC-BLK-1 (REQ-BLK-001, REQ-BLK-003) — 차단 생성 (멱등 + userId 키)
- **Given** A와 B가 같은 모임 멤버
- **When** A가 `POST /blocks { blockedUserId: B }` 를 2회 연속 호출
- **Then** 1회차·2회차 모두 성공(멱등 — 두 번째는 P2002 → 200), `block(A→B)` 단일 행. 매칭 키는 userId(sub)뿐 — B가 게스트든 명명 계정이든 동일. `blockedUserId == A`(자기 차단)는 400

#### AC-BLK-2 (REQ-BLK-002) — 차단 해제 (신고 숨김 불변)
- **Given** A가 B를 신고(report 존재)한 뒤 차단(block 존재)함
- **When** A가 `DELETE /blocks/B`
- **Then** `block(A→B)` 행 삭제. 그러나 report 기반 숨김은 되살아나지 않고 유지됨 — `getHiddenUserIds(A)`에 B가 report 항으로 여전히 포함(차단 해제 ≠ 신고 취소)

#### AC-BLK-3 (REQ-BLK-004, REQ-BLK-005) — 프로필 내 차단 목록·해제 + 멤버 목록 노출
- **Given** A가 B, C를 차단한 상태
- **When** A가 프로필/설정 화면의 "차단한 멤버" 섹션을 열람(`GET /blocks`)
- **Then** B, C가 목록에 표시되고 각 행에서 해제 가능(전용 라우트 없음). 동시에 모임 멤버 목록에는 B, C가 닉네임 보존한 채 그대로 노출(차단 해제 진입점 겸용)

### 모듈 3 — 뷰어 측 필터 (REQ-FLT)

#### AC-FLT-1 (REQ-FLT-001) — 채팅 서버+클라이언트 동시 필터
- **Given** A가 B를 차단, 모임 M 채팅에 B의 과거 메시지 + 신규 실시간 메시지 존재
- **When** A가 채팅 히스토리를 조회하고 B가 실시간 신규 메시지를 발신
- **Then** 히스토리 응답에서 B의 메시지가 서버 쿼리로 제외되고(`senderId notIn`), 실시간 신규 메시지도 클라이언트 `handleIncoming`에서 append 전 드롭됨(양경로 동시). keyset 페이지 크기는 over-fetch 후 trim으로 보존

#### AC-FLT-2 (REQ-FLT-002) — 투표 목록 제외 + 집계 불변
- **Given** A가 B를 차단, 모임 M에 B가 생성한 poll P와 A/C가 P에 투표한 표가 존재
- **When** A가 투표 목록을 조회
- **Then** B가 생성한 poll P가 목록에서 제외됨. 단, 다른 poll의 표 집계 수치는 B의 표를 포함해 변경하지 않음(익명 집계 유지)

#### AC-FLT-3 (REQ-FLT-003) — 지출·정산 행 유지 + 작성자 마스킹 + 정산 불변
- **Given** A가 B를 차단, 모임 M에 B가 만든 expense E(금액 10,000)와 B가 요청자(`requester_id=B`)인 settlement_request S 포함 총 지출 존재
- **When** A가 지출 목록을 조회
- **Then** E 행과 S 행이 목록에서 **제거되지 않고** 작성자/요청자 표시만 '차단한 멤버'로 마스킹되어 반환됨. balance/transactions/total 정산 수치는 E·S를 원본대로 포함해 계산됨(차단하지 않은 다른 멤버 뷰와 동일). 표시 항목 합 == 표시 합계(정합)

#### AC-FLT-4 (REQ-FLT-004) — 일정 슬롯 제외 + 협업 편집 한계
- **Given** A가 B를 차단, 모임 M 일정에 B의 가용 슬롯 + B가 편집한 dates/window 존재
- **When** A가 일정 히트맵을 조회
- **Then** B의 `schedule_slot`이 히트맵 응답에서 제외됨. 단, dates/window 협업 편집은 작성자 추적이 없어 필터되지 않음(한계 — acceptance 명시)

#### AC-FLT-5 (REQ-FLT-005) — 알림 액터 필터
- **Given** A가 B를 차단, A의 알림 피드에 액터=B 알림 + 시스템 알림(액터 없음) 존재
- **When** A가 알림 피드를 조회
- **Then** 액터가 B인 알림만 제외되고, 시스템 알림·액터 없는 알림은 그대로 노출(actorId null 자연 통과)

#### AC-FLT-6 (REQ-FLT-006) — FCM 발신 역방향 억제 (block만)
- **Given** A가 B를 차단(A→B), B와 A가 같은 모임 멤버이고 A가 디바이스 토큰 등록
- **When** B가 채팅 메시지를 발신 → `push.listener` 수신자 산정
- **Then** `getBlockersOf([B])`가 A를 반환해 A가 수신 대상에서 차감되어 A에게 FCM 미발송(잠금화면 미도달). best-effort try/catch 내부 — safety 조회 실패가 발송을 막지 않음
- **When** (대조) A가 B를 신고만 하고 차단하지 않은 경우
- **Then** report는 push를 억제하지 않으므로 A에게 push 유지(명시적 block만 억제)

### 모듈 4 — 모듈 경계 · 인가 (REQ-CPL)

#### AC-CPL-1 (REQ-CPL-001) — 필터 단일 출처 union
- **Given** A가 B를 차단(block)하고 C를 신고(report)한 상태
- **When** `getHiddenUserIds(A)` 호출
- **Then** {B, C} union 반환(중복 제거). 요청당 1회 조회로 소비 도메인에 주입(N+1 회피). 차단 해제(B) 후에도 report 항(C)은 불변

#### AC-CPL-2 (REQ-CPL-002) — 비순환 경계 정적 검사
- **Given** 백엔드 소스 트리
- **When** `apps/backend/src/safety/**`의 import를 정적 검사(grep)
- **Then** safety가 chat/poll/expense/schedule/notification/push 도메인을 import하지 않음(단방향 — 소비 도메인이 BlockService를 import)

#### AC-CPL-3 (REQ-CPL-003, REQ-CPL-004) — WHERE 내장 인가 + RLS default-deny
- **Given** 인증된 사용자 A와 위조된 body(blockerId=타인)를 포함한 요청
- **When** 차단/신고/목록 서비스 실행
- **Then** 인가는 `blockerId == user.sub` / `reporterId == user.sub` WHERE 내장으로만 판정(body/query 불신). `block`·`report` 테이블은 RLS enable + 정책 없음(default deny)이라 PostgREST 직독 불가

### 모듈 5 — 스토어 정책 준수 (REQ-STO)

#### AC-STO-1 (REQ-STO-001, REQ-STO-002) — 신고 데이터 보존 + 운영 절차 문서
- **Given** 여러 신고가 저장된 상태
- **When** 운영자가 수동 DB 조회로 신고를 검토
- **Then** 각 report 행이 대상 유저·모임·사유·콘텐츠 참조·시각을 보존해 검토 가능. 24시간 내 조치 요건은 운영 절차 문서로 대응(관리자 UI·자동 워크플로우 미구축)

## 엣지 케이스

- **채팅 keyset 페이지 축소**(R-1): `notIn` 필터로 `take: N`보다 적게 반환될 수 있음 → over-fetch 후 trim, 커서는 반환분 마지막 id 유지(페이지 크기 보존 테스트)
- **지출 계산 오염 방지**(R-2): 표시용 작성자 마스킹을 계산 입력에 잘못 적용하면 정산 수치가 뷰어별로 어긋남 → 계산=전체 원본, 마스킹은 표시 반환 직전에만(정산 수치 불변 + 표시 항목 합=합계 테스트)
- **서버·클라이언트 필터 계층 불일치**(R-3): 한쪽만 구현 시 리로드 후 노출 → 채팅은 서버(히스토리)+클라이언트(실시간) 동시 구현 강제(양경로 AC-FLT-1 검증)
- **실시간 브로드캐스트 네트워크 노출**(R-4): per-moim 채널 아키텍처 한계 — 네트워크 페이로드는 관찰 가능하며 UI 숨김이 목표(서버 트리거 필터 불가)
- **React Query 부재 잔존 메시지**(R-5): 차단/신고 액션 후 `setMessages([])`+재조회(수동 무효화), Server Action은 `revalidatePath`
- **일정 협업 편집 필터 불가**(R-6): 슬롯만 필터 가능(dates/window 작성자 추적 없음)
- **신고·차단 독립 경계**(R-7): 신고만으로 block 미생성, block은 prompt 수락 시에만. 차단 해제가 report 숨김을 되살리지 않음
- **N+1 회피**(R-9): `getHiddenUserIds`/`getBlockersOf`를 요청/이벤트당 1회 조회 후 재사용(정방향 `@@index([blockerId])`, 역방향 `@@index([blockedUserId])`)
- **계정 삭제 시 고아 행**(R-10): block/report 고아 행 정리는 ACCOUNT-001 `deleteAccount` 트랜잭션 소관(SAFETY 테이블 선행 전제). 탈퇴 사용자 연관 report 행은 삭제(감사 보존 이관 없음). 잔존 행이 필터에 무해함(존재하지 않는 userId 자연 무시)은 유지
- **차단 전 발송된 push**(R-14): REQ-FLT-006은 차단 이후 신규 발신만 억제(기발송 회수 범위 밖, 수용)
- **per-viewer only**(R-13): 차단해도 owner/다른 멤버는 콘텐츠를 계속 보며, DB 직접 조회·API는 차단 무관(의도된 동작)

## 품질 게이트 기준

- **백엔드 테스트**: jest(fake Prisma — jest.fn + `Promise.resolve/reject`), 커버리지 **85%+**. NestJS 데코레이터 phantom 분기는 project-wide 게이트로 흡수(MOIM-001/CHAT-002 선례).
- **느슨한 결합 정적 검사**: safety ↛ 생산 도메인/push import 부재(grep). push → safety 단방향만 허용.
- **apps/web**: 테스트 프레임워크 **부재** — `nx run web:build` + `nx lint web` **0 error**로만 검증(웹 테스트 하네스 설치하지 않음).
- **nx lint backend**: clean(백엔드 ESLint strict).
- openapi.json + api-client `schema.d.ts` 재생성 후 typecheck 통과.

## Definition of Done

- [ ] `Block`·`Report` 모델 + additive 마이그레이션(RLS default-deny + `report.content_type` CHECK + `report.moim_id` FK CASCADE) + `.moai/project/db/` 문서화
- [ ] `SafetyService`(getHiddenUserIds union / getBlockersOf 역방향 / createReport / createBlock / unblock / listBlocks) + `SafetyController`(가드+검증 헬퍼) + `SafetyModule`이 `BlockService` export
- [ ] `app.module.ts`에 `SafetyModule` 등록
- [ ] 읽기 경로 필터 5곳(chat/poll/expense/schedule/notification) — expense는 행 유지+작성자 마스킹
- [ ] 발신 경로 역방향 차감(push.listener — REQ-FLT-006, block만)
- [ ] 각 소비 `*.module.ts` + `push.module.ts`에 `SafetyModule` import(비순환 grep)
- [ ] 웹: 신고 플로우(report만, block 미생성) + 차단 유도 prompt + 멤버 목록 차단 버튼 + 프로필 "차단한 멤버" 섹션 + 채팅 실시간 필터 + `apps/web/lib/safety/*`
- [ ] 백엔드 커버리지 85%+, `nx lint backend` clean, `nx run web:build` + `nx lint web` 0 error
- [ ] openapi + api-client 재생성 + 운영 절차 문서(신고 수동 검토 + 24h 조치)
- [ ] 고아 정리 위임 통지(ACCOUNT-001 `deleteAccount`에 block/report deleteMany — SAFETY 선행 병합 시 즉시, ACCOUNT 선행 시 후속 태스크)
