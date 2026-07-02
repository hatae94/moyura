# SPEC-SAFETY-001 (compact)

## REQ

### 모듈 1 — REQ-RPT (신고)
- **REQ-RPT-001** [Event] When 사용자가 UGC를 사유와 함께 신고하면, `report`(신고자·대상·모임·사유·타입·콘텐츠 참조)를 저장한다.
- **REQ-RPT-002** [Event] When 신고 접수되면, 신고자 화면에서 대상 콘텐츠(및 동일 작성자 UGC)를 즉시 숨긴다 — 진실 공급원=report, `block` 미생성(신고 ≠ 차단).
- **REQ-RPT-003** [Event] When 신고 성공하면, "차단할까요?" 유도 노출. If 수락 then 이때 `block` 행 생성(REQ-BLK-001 재사용). If 거부 then report 숨김 유지, block 미생성.
- **REQ-RPT-004** [Unwanted] If 대상이 복합 PK(poll_vote/expense_share/schedule_slot)이면 then 400 거부 — 단일 PK 4종(chat_message/poll/expense/settlement_request)만.
- **REQ-RPT-005** [Ubiquitous] 콘텐츠 참조를 TEXT 저장, chat_message 필터 시에만 BigInt 캐스팅.

### 모듈 2 — REQ-BLK (차단)
- **REQ-BLK-001** [Event] When 멤버 목록/신고 유도에서 차단하면, `block(차단자,대상)` 생성(멱등, 자기 차단 400).
- **REQ-BLK-002** [Event] When 차단 해제하면, `block` 행 삭제 — report 숨김 불변(해제 ≠ 신고 취소).
- **REQ-BLK-003** [Ubiquitous] 매칭 키 = userId(sub)만(게스트·명명 동일).
- **REQ-BLK-004** [Ubiquitous] 프로필/설정 내 "차단한 멤버" 섹션에서 차단 목록 조회+해제 제공(전용 라우트 없음 — 섹션 위치는 배치 제약).
- **REQ-BLK-005** [State] While 차단 활성 동안, 차단 대상을 멤버 목록에는 노출 유지(닉네임 보존, 해제 진입점).

### 모듈 3 — REQ-FLT (뷰어 측 필터)
- **REQ-FLT-001** [State] While B가 A에게 차단된 동안, 채팅 히스토리는 서버 쿼리로 제외 + 실시간 신규는 클라이언트 드롭(동시).
- **REQ-FLT-002** [State] While 차단 동안, 투표 목록에서 B의 poll 제외 — 표 집계 불변(익명).
- **REQ-FLT-003** [State] While 차단 동안, 지출 표시 목록에서 B의 expense 행 + B가 요청자인 settlement_request 행을 제거하지 않고 작성자/요청자만 '차단한 멤버' 마스킹(라벨은 block∪report 두 소스 모두 적용) — 정산 계산·합계는 원본 포함.
- **REQ-FLT-004** [State] While 차단 동안, 일정 히트맵에서 B의 슬롯 제외 — dates/window 협업 편집은 필터 불가(한계).
- **REQ-FLT-005** [State] While 차단 동안, 알림 피드에서 액터=B 알림 제외(시스템·액터 없는 알림 무관).
- **REQ-FLT-006** [State] While A가 B를 차단한 동안, B 발신 채팅의 FCM 수신 대상에서 A 제외(역방향, block만 — report는 push 억제 안 함).

### 모듈 4 — REQ-CPL (경계·인가)
- **REQ-CPL-001** [Ubiquitous] `safety` 모듈 격리 + `getHiddenUserIds(sub)` 단일 출처(block∪report union, 두 소스 독립).
- **REQ-CPL-002** [Ubiquitous] safety ↛ 생산 도메인(chat/poll/expense/schedule/notification/push) import(소비 도메인이 BlockService import — 단방향).
- **REQ-CPL-003** [Ubiquitous] 인가 = WHERE 내장(`blockerId==sub`/`reporterId==sub`, body/query 불신).
- **REQ-CPL-004** [Ubiquitous] `block`·`report` RLS enable + 정책 없음(default deny).

### 모듈 5 — REQ-STO (스토어 준수)
- **REQ-STO-001** [Ubiquitous] 신고 데이터(대상·모임·사유·콘텐츠 참조·시각) 보존 — 운영자 수동 DB 조회.
- **REQ-STO-002** [Ubiquitous] 24시간 조치 = 운영 절차 문서(관리자 UI·자동 워크플로우 미구축).

## 수락 기준 요약

- AC-RPT-1~4: 신고 저장 / 신고자 측 숨김(block 미생성) / 차단 유도 수락·거부 / 복합 PK 거부·TEXT 참조.
- AC-BLK-1~3: 차단 생성 멱등+userId 키 / 해제 시 report 숨김 불변 / 프로필 섹션 목록·해제 + 멤버 목록 노출 유지.
- AC-FLT-1~6: 채팅 서버+클라 동시 / 투표 제외·집계 불변 / 지출·정산 행 유지+작성자 마스킹·정산 불변(expense+settlement_request) / 일정 슬롯 제외·협업 편집 한계 / 알림 액터 제외 / FCM 역방향 억제(block만).
- AC-CPL-1~3: getHiddenUserIds union·N+1 회피 / 비순환 grep / WHERE 내장 인가 + RLS default-deny.
- AC-STO-1: 신고 필드 보존 + 운영 절차 문서.
- 게이트: 백엔드 jest 85%+ / `nx lint backend` clean / apps/web은 `nx run web:build`+`nx lint web` 0 error(웹 테스트 하네스 부재) / openapi+api-client 재생성 typecheck.

## 수정 파일

- [NEW] `apps/backend/src/safety/**`(module/controller/service/dto/spec)
- [MODIFY] `apps/backend/prisma/schema.prisma`(Block, Report)
- [NEW] `apps/backend/prisma/migrations/<ts>_add_safety/migration.sql`
- [MODIFY] `apps/backend/src/app.module.ts`(SafetyModule 등록)
- [MODIFY] `chat.service.ts` / `poll.service.ts` / `expense.service.ts` / `schedule.service.ts` / `notification.service.ts`(읽기 필터)
- [MODIFY] `apps/backend/src/push/push.listener.ts`(발신 역방향 차감 — REQ-FLT-006)
- [MODIFY] 각 소비 `*.module.ts` + `push.module.ts`(SafetyModule import)
- [MODIFY] `apps/web/app/moims/[id]/chat/page.tsx`(신고 진입 + 실시간 필터 + state 초기화)
- [MODIFY] `apps/web/app/(main)/home/[id]/members-section.tsx` + `member-actions.ts`(차단 버튼/blockAction)
- [MODIFY] `apps/web/app/(main)/profile/**`("차단한 멤버" 섹션)
- [NEW] `apps/web/lib/safety/*`(fetch 헬퍼)
- [REGEN] `apps/backend/openapi.json` + `packages/api-client/src/schema.d.ts`

## 제외 범위

- 관리자 검토 UI / 자동 모더레이션 워크플로우(report 저장만, 수동 DB 조회 문서).
- 글로벌 콘텐츠 삭제·익명화(뷰어 측 필터만, 전역 보존).
- 차단 대상 지출 행 완전 제거(행 유지+작성자 마스킹으로 대체 — 금액·정산 무결성).
- 양방향(2-way) 차단(1-way 확정).
- 복합 PK 콘텐츠 신고(단일 PK 4종만).
- poll/expense/settlement_request 신고 진입점 UI(v1 웹은 채팅 말풍선 한정 — 백엔드는 4종 수용, 추후 확장).
- 일정 협업 편집(dates/window) 필터(슬롯만).
- 실시간 브로드캐스트 서버 측 수신자별 필터(클라이언트 필터로 대체).
- notification fan-out 발신 시점 역방향 차감(읽기 경로가 커버 — 채팅 FCM push만 발신 필터).
- 차단 전 기발송 push 리보크(차단 이후 신규만 억제).
- 차단 목록 전용 설정 라우트(프로필 섹션으로 대체).
- 모바일 네이티브 변경(전 표면 WebView 웹 UI).
- 회원 탈퇴/계정 삭제(SPEC-ACCOUNT-001 소관 — block/report 고아 정리는 ACCOUNT 소유, 탈퇴 사용자 report 행 삭제(감사 이관 없음), SAFETY 테이블 선행).
- 신규 의존성 0개.
