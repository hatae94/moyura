# SPEC-CHAT-002 (compact)

priority: medium | status: draft | depends: SPEC-CHAT-001 (+ SPEC-MOIM-001) | device-gated completion

## REQ (modules: A 발송 / B 토큰 관리 / C 클라이언트·아키텍처)
- REQ-PUSH-001 [Event-driven] 새 채팅 메시지 이벤트 → sender 제외 멤버의 등록 디바이스로 발송(본문 nickname은 서버 측 멤버 조회 해석). (AC-1)
- REQ-PUSH-006 [State-driven] 등록 디바이스 없는 멤버(익명 웹 게스트)에는 미발송. (AC-4)
- REQ-PUSH-002 [Event-driven] 토큰 등록 → 사용자에 연결, 중복 없이 저장. (AC-2)
- REQ-PUSH-003 [Event-driven] 토큰 해제(로그아웃 포함) → 제거(orphan 방지). (AC-2)
- REQ-PUSH-004 [Ubiquitous] ChatModule은 PushModule을 import하지 않음; push는 chat 이벤트 계약에만 단방향 의존. (AC-3)
- REQ-PUSH-005 [Optional] 원격 푸시 지원 빌드는 토큰 획득·등록 + 백그라운드 수신. (AC-5)
- REQ-PUSH-007 [Optional] 알림 탭 → 앱 열기 + 대상 모임 화면(WebView URL). (AC-5)

## Acceptance
- AC-1 이벤트 → 발송(mock), sender 제외
- AC-2 토큰 등록/해제
- AC-3 느슨한 결합 정적 검사(chat ↛ push)
- AC-4 게스트(토큰 없음) 미발송
- AC-5 (device-gated) 실기기 백그라운드 수신 + 탭 — 수동 검증 필수

## Files to modify/create
- [MODIFY] apps/backend/prisma/schema.prisma (DeviceToken)
- [MODIFY] apps/backend/src/app.module.ts (PushModule)
- [MODIFY] apps/backend/package.json (firebase-admin)
- [MODIFY] apps/backend/src/config/env.validation.ts (FIREBASE_CREDENTIALS)
- [MODIFY] apps/mobile/package.json (expo-notifications), app.json, App.tsx/훅
- [NEW] apps/backend/prisma/migrations/<ts>_add_device_token/
- [NEW] apps/backend/src/push/** (module/listener/fcm-sender/device-token ctrl+svc/dto)
- [NEW] apps/mobile/lib/push/register-device.ts, notification-handler.ts
- [NEW] google-services.json(Android, gitignore) / EAS APNs
- [REGEN] openapi.json + packages/api-client

## Exclusions
- chat의 push import(금지), 게스트(익명 웹) 푸시, 네이티브 라우트 딥링크(탭=앱 열기+WebView URL 최소), 알림 그룹핑/뱃지/mute, 웹 푸시, 발송 재시도/큐, bridge 확장(REST 직접 등록)
