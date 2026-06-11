# Acceptance — SPEC-CHAT-002 (FCM 백그라운드 푸시)

> REQ↔AC 매핑은 spec.md 각 REQ의 "AC:" 라인 참조. 모든 AC는 1개 이상의 REQ를 커버한다.

## Given/When/Then 시나리오

### AC-1 (REQ-PUSH-001) — 이벤트 → 발송 (mock)
- **Given** 모임 A에 멤버 2명(멤버1, 멤버2 각각 디바이스 토큰 등록)
- **When** 새 채팅 메시지 도메인 이벤트 발행(sender=멤버1)
- **Then** firebase-admin mock이 **멤버2 토큰으로만** 1회 발송 호출(sender 멤버1 제외), 알림 본문 sender 표시 이름은 서버 측 멤버 조회로 해석

### AC-2 (REQ-PUSH-002, REQ-PUSH-003) — 토큰 등록/해제
- **Given** 인증 사용자
- **When** `POST /devices { token, platform }` → 이후 `DELETE /devices/:token`
- **Then** 등록 시 `device_token` row 존재 → 해제 시 row 제거

### AC-3 (REQ-PUSH-004) — 느슨한 결합 구조 검증
- **Given** 백엔드 소스 트리
- **When** `apps/backend/src/chat/**`의 import 정적 검사
- **Then** push 모듈을 import하지 않음(grep 결과 없음) + push는 `chat-events.ts` 계약만 import

### AC-4 (REQ-PUSH-006) — 게스트(디바이스 미등록) 미발송
- **Given** 모임 A에 게스트(익명 웹, 디바이스 토큰 없음) + 등록 멤버 1명
- **When** 새 채팅 메시지 도메인 이벤트 발행
- **Then** 등록 디바이스가 있는 멤버에게만 발송, 게스트에게는 발송 시도 없음(토큰 미등록 멤버 자연 제외)

### AC-5 (REQ-PUSH-005, REQ-PUSH-007, 디바이스 게이트) — 실기기 백그라운드 수신 + 탭
- **Given** dev build 설치된 실기기 + 등록된 토큰 + Firebase 프로젝트 셋업
- **When** 앱 백그라운드 상태에서 새 메시지 발생, 이후 알림 탭
- **Then** 알림 수신(REQ-PUSH-005) + 탭 시 앱 열림 + 대상 모임 화면(WebView 대상 URL) 표시(REQ-PUSH-007)
- **NOTE**: 이 시나리오는 **device-gated** — 자동 게이트만으로 completed 처리 금지. 실기기/에뮬레이터 수동 검증 필수.

## 엣지 케이스

- 토큰 미등록 멤버만 있는 모임 → 발송 0건(에러 아님)
- 중복 토큰 등록(같은 token 재호출) → upsert(중복 row 없음)
- 만료/무효 FCM 토큰 → best-effort, 발송 실패 무시(재시도 없음, R 큐 비범위)
- 로그아웃 시 토큰 미해제 → orphan token으로 푸시 수신(REQ-PUSH-003로 방지 — 로그아웃에 DELETE 연동 확인)
- Expo Go 환경 → 원격 푸시 불가(알려진 제약, dev build 필수)

## 품질 게이트 기준

- **백엔드 테스트**: jest, 커버리지 **85%+** (이벤트→발송 mock, 등록/해제, sender/게스트 제외 로직).
- **느슨한 결합 정적 검사**: chat → push import 부재 확인.
- **mobile**: 순수 헬퍼 vitest(RN/expo import 없는 모듈만). typecheck `tsc --noEmit`.
- `FIREBASE_CREDENTIALS` Zod 검증(누락 시 fail-fast) 동작 확인.
- **디바이스 게이트(HARD)**: 실기기 백그라운드 수신(AC-5) 수동 검증 전까지 status를 completed로 전환하지 않는다(기존 모바일 SPEC 관례).
- openapi.json + api-client 재생성 후 typecheck 통과.

## Definition of Done

- [ ] `DeviceToken` 모델 + 마이그레이션 + 등록/해제 API(가드)
- [ ] `push.listener`(이벤트 단방향 구독) + `fcm-sender`(firebase-admin) + sender 제외
- [ ] `FIREBASE_CREDENTIALS` env(Zod) + fail-fast
- [ ] 느슨한 결합 정적 검사 통과(chat ↛ push)
- [ ] mobile expo-notifications(권한/토큰/등록/수신/탭) + 로그아웃 토큰 해제 연동(R-3)
- [ ] 백엔드 커버리지 85%+, mobile 순수 헬퍼 vitest + typecheck green
- [ ] openapi + api-client 재생성
- [ ] **(device-gated)** 실기기 백그라운드 수신 수동 검증 — 이 전까지 in-progress
