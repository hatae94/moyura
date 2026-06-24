---
id: SPEC-CHAT-002
version: "0.4.0"
status: in-progress
created: 2026-06-11
updated: 2026-06-25
author: hatae
priority: medium
issue_number: 0
---

# SPEC-CHAT-002 — FCM 백그라운드 푸시

> 수락 기준(Given/When/Then): [acceptance.md](./acceptance.md) | 구현 계획: [plan.md](./plan.md)

## HISTORY

- 2026-06-25 (v0.4.0): 알림 탭 핸들러(REQ-PUSH-007) 앱 통합 + iOS 시뮬레이터 포그라운드 배너·딥링크 라우팅 검증 — status in-progress 유지.
  - **탭 핸들러 앱 배선(이전엔 정의만 됨)**: v0.2.0에서 `registerNotificationTapHandler`(R-PUSH-007)가 구현되었으나 앱 진입점에 배선되지 않았다. 이번에 두 곳을 연결:
    - `apps/mobile/app/_layout.tsx`: (a) `Notifications.setNotificationHandler` 추가 — 포그라운드에서도 알림 배너/목록 표시(앱이 떠 있을 때 새 메시지 알림 묻힘 방지, 소리 on/배지 off). (b) `useEffect`에서 `registerNotificationTapHandler` 구독 — 탭 시 FCM 채팅 URL(`${WEB_URL}/moims/{id}/chat`)에서 `moimId`를 파싱(`moimIdFromChatUrl`)해 `router.push("/(tabs)/home/{id}?target=chat")` 이동(detail-push와 동일한 router.push 패턴, OD-1 안전; 형식 어긋나면 앱 열기만).
    - `apps/mobile/app/(tabs)/home/[id].tsx`: `?target=chat` 쿼리가 있으면 모임 상세 대신 `/moims/{id}/chat` WebView를 직접 로드(`buildChatUrl` 사용). 그 외에는 기존대로 모임 상세(`urlForDetailRoute`) 호스팅.
  - **iOS 시뮬레이터 검증(iPhone 16, dev build, owner-test 로그인)**: (a) 포그라운드 푸시 배너 표시 확인(`setNotificationHandler` 동작 증명). (b) 딥링크 `moyura:///home/{id}?target=chat` 진입 시 "모임 채팅" 화면 렌더 — 탭 핸들러가 생성하는 정확한 `router.push` 목적지 검증. (c) 디바이스 토큰 등록/해제 API + push jest 스위트(34건) green.
  - **여전히 device-gated(미검증)**: 실기기 FCM 종단(end-to-end). iOS 시뮬레이터는 실 FCM 수신 불가 — APNs↔FCM 토큰 불일치(`getDevicePushTokenAsync`는 iOS에서 APNs 토큰을 반환하나 백엔드 `firebase-admin sendEachForMulticast`는 FCM 등록 토큰 필요 → **Android이 깨끗한 경로**; iOS는 `@react-native-firebase/messaging` 필요). 또한 `FIREBASE_CREDENTIALS`는 로컬 백엔드 `.env`에만 추가됨 — prod Render env에는 미추가라 prod 푸시는 자격증명 추가 전까지 no-op.
  - **결론**: AC-5(실기기 FCM 종단 수신)가 미완료이므로 **status = in-progress 유지**. v0.3.0의 잔여 게이트 3개(아래 §8) 중 게이트 3(실기기 수신·탭)에 탭 핸들러 배선 + 시뮬레이터 표시·라우팅 검증이 더해졌고, 실기기 FCM 라운드트립만 남았다.
- 2026-06-18 (v0.3.0): firebase-admin 백엔드 배선 + 인증·FCM 도달 라이브 검증 — status in-progress 유지.
  - `FIREBASE_CREDENTIALS` 배선 완료: `credentials/GoogleServiceAccount.json`(Firebase 서비스 계정, `project_id=moyura-498500`)을 `apps/backend/.env`의 `FIREBASE_CREDENTIALS` env에 단일 행 JSON 문자열로 주입(gitignore — 비밀 키 미커밋). `FcmSender`는 `JSON.parse(FIREBASE_CREDENTIALS)` → `admin.credential.cert()` 경로로 초기화.
  - firebase-admin 초기화 성공 확인: 백엔드 재시작 후 "FIREBASE_CREDENTIALS 미설정 no-op" 경고 소멸 + init-failure 경고 없음. no-op 경로 해제, 실 FCM 발송 활성화.
  - 라이브 발송 경로 검증(standalone firebase-admin + 서비스 계정, `sendEachForMulticast`): admin 초기화 OK(project `moyura-498500`), 요청이 Google 인증을 통과해 FCM에 실제 도달함. 가짜 토큰에 대해 per-token 실패 코드 `messaging/mismatched-credential` 반환 — "Firebase Cloud Messaging API has not been used in project moyura-498500 before or it is disabled." **이는 서비스 계정 자격증명이 유효하며 백엔드 발송 경로가 FCM 경계까지 정상 동작함을 증명한다**. 실패 원인은 자격증명 오류가 아니라 FCM API 자체가 비활성화됨.
  - 정밀 잔여 게이트 3개 (아래 §8 "보류 — 잔여 게이트" 참조):
    1. [사용자 — Google Cloud Console] project `moyura-498500`에서 Cloud Messaging API(`fcm.googleapis.com`) 활성화 필요.
    2. [사용자 — 프로젝트 일관성] Firebase 프로젝트 불일치: 서비스 계정은 `moyura-498500`, 모바일 클라이언트 config(`credentials/GoogleService-Info.dev.plist`)는 `moyura-6c430`(`PROJECT_ID=moyura-6c430`). 종단 FCM을 위해 서버 서비스 계정과 모바일 클라이언트 config가 **동일 Firebase 프로젝트**여야 함. `moyura-498500`용 `GoogleService-Info.plist` 확보 + `app.json` `ios.googleServicesFile` 배선 필요(현재 `app.json`에 `googleServicesFile`/FCM 배선 없음 — 잘못된 프로젝트의 plist를 의도적으로 추가하지 않음).
    3. [실기기] AC-5 실기기 FCM→APNs 백그라운드 수신 + 알림 탭은 물리적 iOS 기기 필요. iOS 시뮬레이터는 실 FCM/APNs 라운드트립 불가(`xcrun simctl push` 주입 페이로드와 다름).
  - 서버 절반 기능 완료: firebase-admin 배선 + 인증 + FCM 도달가능성 라이브 검증. `PushListener` → `FcmSender` 통합 로직은 기존 jest 검증 완료. 클라이언트 설정(게이트 1·2)과 실기기 수신(게이트 3) 해소 시 `completed` 전환 가능.
- 2026-06-13 (v0.2.0): run 자동화 가능 표면 완료 — status draft → in-progress.
  - DeviceToken 모델 + 마이그레이션(`20260614_add_device_token`) + 등록/해제 REST API(owner-scoped IDOR 차단) 구현.
  - PushListener(`@OnEvent` 단방향 구독, sender/게스트 제외, 서버 측 nickname 조회) + FcmSender(firebase-admin, FIREBASE_CREDENTIALS 부재 시 graceful no-op) 구현.
  - mobile expo-notifications 헬퍼(`register-device-core` / `notification-core`) + 얇은 래퍼(`register-device` / `notification-handler`) + AuthContext 등록 배선 + useAuthBridge 로그아웃 해제 연동.
  - 검증: backend jest 206/206, mobile vitest 151/151, tsc 0(backend+mobile), prisma migrate status clean, api-client generate+typecheck green. 느슨한 결합(chat↛push) grep + loose-coupling.spec 확인.
  - TRUST 5 PASS, evaluator Security PASS (IDOR fix: unregisterByOwner owner-scoped deleteMany 적용).
  - status → in-progress: AC-5(실기기 FCM 백그라운드 수신 + 알림 탭)는 device-gated — Firebase 프로젝트 + dev build + 실기기 수동 검증 필요(§8 기준, mobile-spec-device-gated 관례).
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

---

## Implementation Notes (as-implemented)

> 구현 완료 내용, 계획 대비 수정 사항, 보류 게이트를 기록한다. 수동 갱신 기준: 2026-06-13(v0.2.0).

### 구현된 파일

**backend:**
- `apps/backend/src/push/push.module.ts` — PushModule 정의(DeviceTokenService/Controller, PushListener, FcmSender, PrismaModule/MoimModule import)
- `apps/backend/src/push/push.listener.ts` — `@OnEvent('chat.message.created')` 단방향 구독. sender 제외 + 게스트(토큰 미등록) 자연 제외 + 서버 측 nickname 조회 + FcmSender 호출
- `apps/backend/src/push/fcm-sender.ts` — firebase-admin 초기화(singleton 가드) + graceful no-op(FIREBASE_CREDENTIALS 부재 시 경고 후 반환)
- `apps/backend/src/push/device-token.service.ts` — upsert(중복 없음), unregisterByOwner(userId+token 조건 owner-scoped deleteMany), findByUserIds
- `apps/backend/src/push/device-token.controller.ts` — `POST /devices`(등록), `DELETE /devices/:token`(owner-scoped, `@CurrentUser` sub 기반)
- `apps/backend/src/push/dto/` — register-device.dto.ts, device-token-response.dto.ts
- `apps/backend/src/push/*.spec.ts` + `loose-coupling.spec.ts` — 단위 테스트 25건 + 느슨한 결합 grep 검증
- `apps/backend/src/app.module.ts` — PushModule import 추가(ChatModule 뒤 배치)
- `apps/backend/prisma/schema.prisma` — DeviceToken 모델 추가
- `apps/backend/prisma/migrations/20260614_add_device_token/` — device_token 테이블 마이그레이션

**mobile:**
- `apps/mobile/lib/push/register-device-core.ts` + `register-device-core.test.ts` — Expo 토큰 획득 + API 등록/해제 순수 로직(vitest)
- `apps/mobile/lib/push/notification-core.ts` + `notification-core.test.ts` — 알림 수신 + 탭 핸들러 순수 로직(vitest)
- `apps/mobile/lib/push/register-device.ts` — Expo 의존 얇은 래퍼(registerDevice/unregisterDevice)
- `apps/mobile/lib/push/notification-handler.ts` — Expo 의존 얇은 래퍼(setupNotificationHandlers)
- `apps/mobile/lib/auth/AuthContext.tsx` — 로그인 후 registerDevice 자동 호출 배선
- `apps/mobile/hooks/useAuthBridge.ts` — `session:cleared` 수신 시 unregisterDevice 연동

### 계획 대비 수정 사항

- **firebase-admin@13.10.0** (계획 대비 `@^14` 아님): firebase-admin 14는 Node 22+ 요구. 프로젝트 `engines >= 20` 정책 준수를 위해 13.10.0 채택(Node 20+ 지원). peerDependencies 충돌 없음.
- **expo-notifications@~56.0.17** (`expo install` 경유): SDK 56 호환 버전. `package.json`에 기재, Expo 버전 관리 정책 준수.
- **FIREBASE_CREDENTIALS Zod optional + graceful no-op**: 계획은 "누락 시 fail-fast"였으나, 테스트 환경 + 미배포 단계에서 부팅 차단이 실용적이지 않아 optional로 변경. 부재 시 경고 로그 출력 후 FcmSender가 no-op 반환. FIREBASE_CREDENTIALS 존재 시에만 firebase-admin 초기화.
- **mobile 배선 위치 (AuthContext.tsx + useAuthBridge.ts)**: 계획 §6에 `App.tsx` 배선이 명시되었으나, SPEC-MOBILE-003에서 `App.tsx`가 제거되고 expo-router `app/` 트리로 대체됨. AuthContext.tsx(로그인 후 토큰 등록) + useAuthBridge.ts(`session:cleared` 해제)로 배선.
- **IDOR 수정 (evaluator Security 지적)**: 초기 구현에서 `DELETE /devices/:token`이 소유권을 검증하지 않는 IDOR 취약점이 evaluator에 의해 발견됨. `unregisterByOwner(userId, token)` — `where: { token, userId }` owner-scoped deleteMany로 수정 완료(OWASP A01 대응).
- **orphan-token 수정**: `AuthContext.tsx`에서 `registerDevice()` 반환 토큰을 `registeredTokenRef`로 보관, `unregisterDevice(registeredTokenRef.current)` 명시적 전달로 수정.
- **GoneException-style 표준 예외 n/a**: 이 SPEC에서는 초대(MOIM-002) 패턴의 GoneException이 해당 없음(디바이스 토큰은 만료/폐기 개념 없음).

### 브랜치 커버리지 현실 (authored 100%, branch 83.63%)

- `apps/backend/src/push` authored 로직: **statement 100%, function 100%, line 100%**.
- **branch 83.63%**: NestJS `@ApiOperation`, `@ApiBody`, `@ApiResponse`, `@UseGuards` 등 데코레이터가 jest/v8 coverage에서 phantom 분기를 생성. istanbul-ignore 주석은 `emitDecoratorMetadata` 컴파일 결과물에 대해 이 jest 셋업에서 비기능적.
- **project-wide branch 85.08% PASS**: 전체 backend 기준 85% 게이트 통과. push 모듈 단독 브랜치 미달은 MOIM-001 precedent에 따라 NestJS 데코레이터 phantom 노이즈로 수용.
- 실질적 미커버(추가 테스트로 해소): recipient-0 분기, already-initialized FcmSender 분기, IDOR 소유권 검증 분기 — 모두 추가 테스트로 해소 완료(최종 jest 206/206).

### 마이그레이션 체크섬 드리프트 대응

- `20260613175232_add_chat` 마이그레이션이 `prisma migrate status`에서 체크섬 드리프트 경고를 발생시킴(이전 수동 SQL 추가로 인한 파일 수정).
- 대응: `prisma migrate resolve --applied 20260613175232_add_chat` 실행 후 `20260614_add_device_token` 마이그레이션 `db execute` + `migrate resolve --applied`로 적용.
- `prisma migrate status`: clean(드리프트 없음, 2026-06-13 기준).

### 보류 — 잔여 게이트 (v0.3.0 기준)

**완료된 서버 절반**: `FIREBASE_CREDENTIALS` 배선 + firebase-admin 초기화 + Google 인증 통과 + FCM 도달가능성 라이브 검증(2026-06-18). `PushListener` → `FcmSender` 통합 jest 검증 기완료. 서버 발송 경로는 기능적으로 완성.

**잔여 게이트 3개** (이 중 1·2는 사용자 액션, 3은 실기기 필요):

1. **[사용자 — Google Cloud Console] FCM API 활성화 필요**: Google Cloud Console → project `moyura-498500` → API 및 서비스 → `Firebase Cloud Messaging API` (`fcm.googleapis.com`) 활성화. 현재 모든 FCM 발송이 `messaging/mismatched-credential: Firebase Cloud Messaging API has not been used in project moyura-498500 before or it is disabled.`로 실패. 서비스 계정 자격증명 자체는 유효함(Google 인증 통과 확인됨).

2. **[사용자 — 프로젝트 일관성] Firebase 프로젝트 불일치 해소 필요**: 서비스 계정 `project_id=moyura-498500` vs 모바일 클라이언트 `credentials/GoogleService-Info.dev.plist` `PROJECT_ID=moyura-6c430`. 종단 FCM 동작을 위해 동일 Firebase 프로젝트 필요. 사용자 액션: `moyura-498500` Firebase 프로젝트의 `GoogleService-Info.plist` 확보 → `apps/mobile/credentials/`에 배치 → `app.json` `ios.googleServicesFile` + expo-notifications FCM config 배선. `google-services.json`(Android) + APNs 자격증명(iOS, EAS credentials)도 동일 프로젝트 기준으로 설정.

3. **[실기기] dev build 백그라운드 수신·탭 수동 검증 필요**: Expo Go는 원격 푸시 불가. EAS dev build 또는 `expo run:ios`. 앱 백그라운드 상태에서 메시지 전송 → FCM 수신(REQ-PUSH-005) + 알림 탭 → 앱 열림 + 대상 모임 WebView URL(REQ-PUSH-007). 물리적 iOS 기기 필요(iOS 시뮬레이터는 실 FCM/APNs 라운드트립 불가).

이 3개 게이트 완료 전까지 **status = in-progress 유지**.
