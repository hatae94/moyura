---
id: SPEC-CHAT-002
version: "0.1.1"
status: draft
created: 2026-06-11
updated: 2026-06-11
author: hatae
priority: medium
issue_number: 0
---

# SPEC-CHAT-002 — FCM 백그라운드 푸시

> 수락 기준(Given/When/Then): [acceptance.md](./acceptance.md) | 구현 계획: [plan.md](./plan.md)

## HISTORY

- 2026-06-11 (v0.1.1): plan-auditor iteration 1 FAIL 대응 개정.
  - 고아였던 AC-4(게스트 제외)를 1급 REQ로 승격(REQ-PUSH-006).
  - REQ-PUSH-002/003에서 엔드포인트 경로·DB 연산 제거 — 행위 기술로 환원(HOW는 plan.md/§6).
  - REQ-PUSH-001/005에서 모듈명·라이브러리명 제거(REQ-PUSH-004의 아키텍처 제약 명명은 요구사항 본질이므로 유지). REQ-PUSH-005를 응답 단위로 분리(REQ-PUSH-005 수신 / REQ-PUSH-007 탭).
  - 푸시 알림 본문의 sender 표시 이름은 이벤트 페이로드가 아닌 서버 측 멤버 조회로 해석(CHAT-001 게이트 결정 전파). priority 소문자화. 각 REQ에 커버 AC ID 표기. acceptance.md 링크 추가.
- 2026-06-11 (v0.1.0): 최초 작성(draft). 인터뷰 4개 결정 + 계획 검토 게이트 승인 반영.
  - 구조: expo-notifications(Expo 56) 클라이언트 + device_token 레지스트리 + NestJS firebase-admin 발송자.
  - 느슨한 결합(HARD): push가 `chat.message.created`를 `@nestjs/event-emitter`로 단방향 구독. chat은 push를 import/인지하지 않는다.
  - 게이트 결정(추가 비범위): 게스트(익명 웹) 사용자는 푸시 대상 제외 — 네이티브 앱 없음. FCM은 등록 사용자 디바이스만 대상.
  - 공유 리서치: [research.md](../SPEC-CHAT-001/research.md), 인터뷰: [interview.md](../SPEC-CHAT-001/interview.md).

## 1. 목표 (Goal)

앱이 백그라운드 상태일 때 새 메시지를 FCM 푸시로 수신한다. NestJS `PushModule`이 chat이 발행한 `chat.message.created` 도메인 이벤트를 `@nestjs/event-emitter`로 **단방향 구독**해 firebase-admin으로 발송하고, mobile은 expo-notifications로 토큰을 등록/수신한다. **채팅 모듈은 푸시의 존재를 모른다**(느슨한 결합 HARD 요구).

## 2. 배경 (Context)

느슨한 결합 구조(research §7b):
```
ChatService.sendMessage()
  └─ prisma.chatMessage.create()
  └─ eventEmitter.emit('chat.message.created', payload)   // chat 소유 계약
       └─ (구독) PushListener → 수신 대상 조회(moim_member - sender ⋈ device_token)
            └─ FcmSender.send(tokens, notification)        // firebase-admin
```
- chat은 push를 import하지 않는다. push는 chat이 export한 이벤트 계약(`chat-events.ts`)에만 단방향 의존.
- 디바이스 토큰 전달은 bridge-protocol 확장 대신 **REST 직접 등록**(`POST /devices`, SecureStore access token Bearer) — bridge 무수정(R-1).

상세: 공유 리서치 [research.md](../SPEC-CHAT-001/research.md) §4, §7(b), §8.3.

## 3. 가정 (Assumptions)

- SPEC-CHAT-001 완료 → `chat.message.created` 이벤트 계약 + `@nestjs/event-emitter` 인프라 존재.
- **Firebase 프로젝트 + 서비스 계정 키는 run 단계에서 셋업**(본 SPEC은 전제 가정으로만 명시). dev build 필요(Expo Go 원격 푸시 불가).
- 게스트(익명 웹) 사용자는 네이티브 앱이 없어 디바이스 토큰이 없다 → 자연히 푸시 대상에서 제외.
- 알림 본문의 sender 표시 이름은 이벤트 페이로드(id+preview)가 아닌 **서버 측 멤버 조회로 해석**(CHAT-001 게이트 결정 전파 — 이벤트 페이로드는 nickname 미포함).

## 4. 요구사항 (EARS Requirements)

요구사항 모듈: 3개 (모듈 ≤ 5 한도 준수). 각 REQ는 단일 행위를 기술하며, 커버하는 AC ID를 함께 표기한다. 엔드포인트 경로·DB 연산·라이브러리명은 정규 텍스트에서 제외하고 §6 Delta Markers/plan.md에 둔다(단, REQ-PUSH-004의 아키텍처 제약 명명은 요구사항 본질이므로 유지).

### 모듈 A — 발송

#### REQ-PUSH-001 [Event-driven] — 이벤트 → 발송
**When** 새 채팅 메시지 도메인 이벤트가 발행되면, 시스템은 sender를 제외한 모임 멤버 중 등록된 디바이스로 알림을 발송한다(알림 본문의 sender 표시 이름은 서버 측 멤버 조회로 해석)(shall). — AC: AC-1

#### REQ-PUSH-006 [State-driven] — 게스트(디바이스 미등록) 제외
**While** 모임에 등록된 디바이스가 없는 멤버(예: 익명 웹 게스트)가 포함된 동안, 시스템은 그 멤버에게는 발송을 시도하지 않는다(등록 디바이스 보유 멤버에게만 발송)(shall). — AC: AC-4

### 모듈 B — 디바이스 토큰 관리

#### REQ-PUSH-002 [Event-driven] — 토큰 등록
**When** 인증된 사용자가 디바이스 토큰을 등록하면, 시스템은 그 토큰을 사용자에 연결하여 중복 없이 저장한다(shall). — AC: AC-2

#### REQ-PUSH-003 [Event-driven] — 토큰 해제 (로그아웃 연동)
**When** 사용자가 디바이스 토큰 해제를 요청하면(로그아웃 흐름 포함), 시스템은 그 토큰을 제거한다(orphan token 방지)(shall). — AC: AC-2

### 모듈 C — 클라이언트 통합 및 아키텍처 제약

#### REQ-PUSH-004 [Ubiquitous] — 느슨한 결합 (단방향)
`ChatModule`은 `PushModule`을 import하지 않으며, push는 chat이 export한 이벤트 계약에만 단방향 의존한다(shall not import). — AC: AC-3

#### REQ-PUSH-005 [Optional] — dev build 백그라운드 수신
**Where** 디바이스가 원격 푸시를 지원하는 빌드인 경우, 시스템(모바일 클라이언트)은 푸시 토큰을 획득하여 등록하고 백그라운드에서 알림을 수신한다(shall). — AC: AC-5

#### REQ-PUSH-007 [Optional] — 알림 탭 시 앱 열기
**Where** 사용자가 수신 알림을 탭하는 경우, 시스템(모바일 클라이언트)은 앱을 열고 대상 모임 화면(WebView 대상 URL 최소 구현)을 표시한다(shall). — AC: AC-5

## 5. 비범위 (Exclusions — What NOT to Build)

- **채팅 모듈의 푸시 인지/import** — **금지**(느슨한 결합 HARD). chat → push 의존 방향 절대 불가.
- **게스트(익명 웹) 사용자 푸시** — 네이티브 앱 없음. FCM은 등록 사용자 디바이스만 대상(게이트 결정).
- **네이티브 채팅 화면 + 푸시 탭 네이티브 라우트 딥링크** — 탭 시 "앱 열기 + WebView 대상 URL"의 최소 구현만; 네이티브 라우트 연동은 SPEC-MOBILE-003 후속(R-4).
- **알림 그룹핑/뱃지 카운트/음소거(mute) 설정**.
- **웹 푸시(브라우저)**.
- **푸시 발송 재시도/큐/배달 보장**(at-least-once 큐잉) — best-effort fire-and-forget.
- **bridge-protocol 확장(토큰 전달용)** — REST 직접 등록 채택(R-1).

## 6. 변경 마커 (Delta Markers — Brownfield)

- [MODIFY] `apps/backend/prisma/schema.prisma` — `DeviceToken` 모델
- [MODIFY] `apps/backend/src/app.module.ts` — `PushModule` import(ChatModule 뒤, chat은 push 미인지)
- [MODIFY] `apps/backend/package.json` — `firebase-admin` 추가
- [MODIFY] `apps/backend/src/config/env.validation.ts` — `FIREBASE_CREDENTIALS`(Zod)
- [MODIFY] `apps/mobile/package.json` — `expo-notifications`
- [MODIFY] `apps/mobile/app.json` — expo-notifications config plugin + google-services 참조
- [MODIFY] `apps/mobile/App.tsx`(또는 훅) — 권한/토큰 등록/수신/탭 핸들러 배선
- [NEW] `apps/backend/prisma/migrations/<ts>_add_device_token/`
- [NEW] `apps/backend/src/push/**` — module/listener/fcm-sender/device-token controller+service/dto
- [NEW] `apps/mobile/lib/push/register-device.ts`, `notification-handler.ts`
- [NEW] `google-services.json`(Android, gitignore 권장) / EAS APNs credentials(iOS)
- [REGEN] `apps/backend/openapi.json` + `packages/api-client`

## 7. 의존성 (Dependencies)

- 선행 SPEC: **SPEC-CHAT-001 완료**(`chat.message.created` 계약 + `@nestjs/event-emitter`). **SPEC-MOIM-001**(멤버 조회).
- 외부 셋업(run 단계 사용자 작업, 전제 가정): Firebase 프로젝트 + 서비스 계정 키(`FIREBASE_CREDENTIALS`), `google-services.json`(Android), APNs 키(iOS, EAS credentials). dev build 필요.
- 기존 자산: `SecureStore`(토큰 등록 시 access token), Zod env 스키마(`env.validation.ts`), `SupabaseAuthGuard`.

## 8. 품질 게이트 (Quality Gate)

- 백엔드: jest TDD, 커버리지 85%+ (이벤트→발송 mock, 토큰 등록/해제, sender 제외 로직).
- 느슨한 결합 정적 검사: `apps/backend/src/chat/**`가 push 모듈을 import하지 않음(grep/정적 확인).
- mobile: 순수 헬퍼 vitest(RN/expo import 없는 모듈).
- **디바이스 게이트**: 실기기/dev build 백그라운드 수신은 수동 검증 필요 — 자동 게이트(단위 테스트, 빌드)만으로 **completed 처리 금지**(기존 모바일 SPEC 관례).
