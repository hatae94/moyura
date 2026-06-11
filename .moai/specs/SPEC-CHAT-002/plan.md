# Plan — SPEC-CHAT-002 (FCM 백그라운드 푸시)

> 공유 리서치: [research.md](../SPEC-CHAT-001/research.md) | 인터뷰: [interview.md](../SPEC-CHAT-001/interview.md)

## 구현 접근

푸시는 채팅의 부가 레이어로, chat이 발행한 도메인 이벤트를 단방향 구독한다. 백엔드는 device_token 레지스트리 + 이벤트 리스너 + firebase-admin 발송자, mobile은 expo-notifications로 토큰 획득→REST 등록→수신/탭. chat → push 의존은 절대 만들지 않는다(정적 검사로 강제).

## 마일스톤 분할 (run 단계)

### M1 — device_token 레지스트리 (RED → GREEN)
- `schema.prisma`에 `DeviceToken` 추가 → `prisma migrate dev --name add_device_token`
- `DeviceTokenService.register(sub, token, platform)`(upsert) / `unregister(sub, token)`(삭제)
- `device-token.controller.ts`: `POST /devices`, `DELETE /devices/:token`(가드 적용)
- 등록/해제 단위 테스트

### M2 — 이벤트 리스너 + FCM 발송 + env
- `@nestjs/event-emitter` `@OnEvent(CHAT_MESSAGE_CREATED)` 리스너(`push.listener.ts`)
- 수신 대상 조회: `moim_member`(moimId) − sender ⋈ `device_token` (등록 디바이스 없는 멤버는 자연 제외 → REQ-PUSH-006)
- 알림 본문 sender 표시 이름: 이벤트 페이로드에 nickname이 없으므로 senderId로 `moim_member.nickname`를 **서버 측 조회**해 해석(CHAT-001 게이트 결정 전파)
- `FcmSender.send(tokens, notification)`(firebase-admin)
- `env.validation.ts`에 `FIREBASE_CREDENTIALS` 추가(누락 시 fail-fast)
- 이벤트→발송 mock 테스트(firebase-admin mock, sender 제외 + 게스트 미발송 확인) + 느슨한 결합 정적 검사

### M3 — mobile expo-notifications 통합
- `expo-notifications` 설치 + `app.json` config plugin + google-services 참조
- `register-device.ts`: 권한 요청 → 토큰 획득 → `POST /devices`(SecureStore access token Bearer)
- `notification-handler.ts`: 수신 핸들러 + 탭 시 앱 열기(WebView 대상 URL 최소 구현)
- 로그아웃 흐름에 `DELETE /devices/:token` 연동(R-3)
- 순수 헬퍼 vitest

### M4 — 디바이스 게이트 (수동 검증)
- Firebase 프로젝트/서비스 계정 키 셋업(사용자) + dev build
- 실기기/에뮬레이터 백그라운드 수신 수동 검증 → **이 검증 전까지 in-progress 유지**

## REQ → 구현 매핑

| REQ | 구현 지점 |
|-----|-----------|
| REQ-PUSH-001 (발송) | `push.listener.ts` `@OnEvent` → `fcm-sender.service.ts` (sender 제외 + 서버 측 nickname 조회) |
| REQ-PUSH-002 (등록) | `POST /devices` → `device-token.service.ts` upsert |
| REQ-PUSH-003 (해제) | `DELETE /devices/:token` → `device-token.service.ts` delete + 로그아웃 연동 |
| REQ-PUSH-004 (느슨한 결합) | chat ↛ push 정적 검사 + push가 `chat-events.ts`만 import |
| REQ-PUSH-005 (수신) | `apps/mobile/lib/push/register-device.ts` + `notification-handler.ts`(수신) |
| REQ-PUSH-006 (게스트 제외) | 대상 조회의 `device_token` join — 미등록 멤버 자연 제외 |
| REQ-PUSH-007 (탭) | `notification-handler.ts`(탭 → 앱 열기 + WebView URL) |

## 기술 스택 / 의존성 (production stable only)

- 백엔드 신규: `firebase-admin`(production stable 라인 — run 단계에서 정확한 버전 핀).
- 모바일 신규: `expo-notifications`(Expo 56 호환 버전 — `apps/mobile/AGENTS.md` 정책에 따라 공식 문서 확인 후 핀).
- 기존: `expo-secure-store ~56.0.4`(토큰 등록 시 access token), `@nestjs/event-emitter`(CHAT-001 설치), Zod 4.4.3.

## Prisma 모델 (초안)

```prisma
model DeviceToken {
  token     String   @id
  userId    String   // profile.id
  platform  String   // "android" | "ios"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([userId])
  @@map("device_token")
}
```

## 리스크 분석 + 완화

| # | 리스크 | 완화 |
|---|--------|------|
| R-1 | bridge 동기 수정 부담 | native→backend 토큰 전달을 **REST 직접 등록**(`POST /devices`)으로. bridge 무수정. |
| R-3 | orphan token(로그아웃 후 푸시 수신) | 로그아웃 흐름에 `DELETE /devices/:token` 연결(REQ-PUSH-003). |
| R-4 | 탭 네비게이션이 SPEC-MOBILE-003 라우터 의존 | "앱 열기 + WebView URL" 최소 구현으로 한정. 네이티브 라우트 연동은 후속. |
| R-ENV | Firebase 자격 증명 관리 | `FIREBASE_CREDENTIALS`(JSON/파일 경로) Zod 검증 추가, 누락 시 fail-fast. 시크릿 커밋 금지(env/Render secrets). |
| R-EXPO56 | Expo 56 expo-notifications bleeding-edge | 동작 추측 금지 → 공식 문서 우선 확인(`apps/mobile/AGENTS.md`). |
| 게스트 제외 | 익명 웹 사용자에 발송 시도 | device_token 없는 사용자는 자연 제외. 발송 대상 쿼리가 device_token join이므로 토큰 없으면 미발송. |
| 결합 위반 | chat이 push import | 정적 검사(grep `from '../push'` in chat/**)로 차단. REQ-PUSH-004. |

## 생성/수정 파일

- [MODIFY] `apps/backend/prisma/schema.prisma` (`DeviceToken`)
- [NEW] `apps/backend/prisma/migrations/<ts>_add_device_token/migration.sql`
- [NEW] `apps/backend/src/push/push.module.ts`, `push.listener.ts`, `fcm-sender.service.ts`, `device-token.controller.ts`, `device-token.service.ts`, `dto/*.ts`
- [NEW] `apps/backend/src/push/*.spec.ts` (firebase-admin mock)
- [MODIFY] `apps/backend/src/app.module.ts` (PushModule)
- [MODIFY] `apps/backend/package.json` (firebase-admin)
- [MODIFY] `apps/backend/src/config/env.validation.ts` (FIREBASE_CREDENTIALS)
- [MODIFY] `apps/mobile/package.json` (expo-notifications)
- [NEW] `apps/mobile/lib/push/register-device.ts`, `notification-handler.ts` (+ 순수 헬퍼 vitest)
- [MODIFY] `apps/mobile/app.json` (plugin + google-services)
- [MODIFY] `apps/mobile/App.tsx` 또는 훅 (배선)
- [NEW] `google-services.json`(Android, gitignore) / EAS APNs credentials
- [REGEN] `apps/backend/openapi.json`, `packages/api-client/src/schema.d.ts`

## MX 태그 계획 (mx_plan)

- `@MX:NOTE` — `push.listener.ts`의 `@OnEvent(CHAT_MESSAGE_CREATED)` 핸들러: **단방향 의존 경계** 명시(push가 chat 계약 import, 역방향 금지).
- `@MX:ANCHOR` — `DeviceTokenService` 등록/해제 진입점(mobile + 로그아웃 흐름이 의존).
- `@MX:WARN` (+ `@MX:REASON`) — `fcm-sender.service.ts`: 외부 네트워크 호출(firebase-admin) + best-effort 실패 무시 의미(재시도/큐 없음).
- `@MX:NOTE` — `register-device.ts`: 토큰 등록이 bridge가 아닌 REST 직접 등록인 이유(R-1).
- `@MX:NOTE` — device 라우트의 `SupabaseAuthGuard` 적용 지점(인증 재사용); `env.validation.ts` `FIREBASE_CREDENTIALS`는 기존 @MX:ANCHOR 스키마 확장.

## 참조 (Reference)

- Reference: `apps/backend/src/profile/profile.service.ts` / `profile.service.spec.ts` — 서비스 + 단위 테스트 패턴
- Reference: `apps/backend/src/config/env.validation.ts` — Zod env 스키마(@MX:ANCHOR) 확장 지점(`FIREBASE_CREDENTIALS`)
- Reference: `apps/backend/src/auth/supabase-auth.guard.ts` — device 라우트 가드 재사용
- Reference (선행): `.moai/specs/SPEC-CHAT-001/spec.md` + `chat-events.ts` 계약(`CHAT_MESSAGE_CREATED`, `ChatMessageCreatedPayload`)
- Reference: `apps/mobile/lib/auth/token-store.ts` — SecureStore access token(등록 시 Bearer)
- Reference: `apps/mobile/App.tsx`, `apps/mobile/hooks/useAuthBridge.ts` — 핸들러 배선 + 로그아웃 흐름 연동 지점
- Reference: `apps/mobile/app.json` — Expo config plugin 추가 위치
- Reference: [research.md](../SPEC-CHAT-001/research.md) §4, §7(b), §8.3 — 느슨한 결합 구조 + 환경 변수
