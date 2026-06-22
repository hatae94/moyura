# 셸 SPEC status 감사 — 2026-06-23 (자율 루프 C4)

> 자율 야간 루프 중 작성(사용자 수면). **status 필드는 변경하지 않았다** — foundational SPEC 의 공식 종료는 사용자/디바이스 검증 판단이 필요하므로, 본 문서는 현황 정리 + 권고만 제공한다(보수적). 깨어난 뒤 검토·결정 권장.

## 대상

`in-progress` 로 남아 있는 모바일 셸 파운데이션 SPEC 4건 중 3건을 감사한다(MOBILE-003 은 별도 — "iOS 핵심 플로우 검증 완료, Google OAuth/Android/로그아웃 E2E 대기"로 명확).

| SPEC | 제목 | 현 status | 구현 | 잔여(왜 in-progress) |
|------|------|-----------|------|----------------------|
| SPEC-MOBILE-001 | RN WebView 셸 + Google OAuth 브리지 | in-progress (v0.2.0) | 완료(자동 게이트) | R-P2 종단·OD-2 디바이스 검증 미완 — **단, 구현이 후속으로 대체됨(아래)** |
| SPEC-MOBILE-002 | 토큰 기반 느슨한 결합 세션 파운데이션 | in-progress (v0.2.1) | 완료(보안 루프 closed, vitest 89/89) | AC-V3 디바이스 종단 OAuth/핸드셰이크 검증 미완 |
| SPEC-WEBVIEW-SHELL-001 | WebViewShell 컴포넌트화(행위 보존 추출) | in-progress (v0.1.0) | 완료(vitest 21/21) | AC-S3 디바이스 종단 검증 미완 |

## 핵심 발견

1. **세 SPEC 모두 구현 완료 + 자동 게이트(typecheck/vitest/expo export) 통과** 상태로 코드에 살아 있다. WebViewShell(`components/WebViewShell.tsx`)·토큰 브리지(`lib/native-bridge/`·`hooks/useAuthBridge.ts`)는 현재 앱에서 활발히 사용 중이다.

2. **SPEC-MOBILE-001 은 구현이 후속 SPEC 으로 대체(superseded)됐다**:
   - `App.tsx`(MOBILE-001 의 풀스크린 WebView 셸)는 **SPEC-MOBILE-003 에서 제거**됨(expo-router 엔트리로 전환 — tech.md 확인: "App.tsx 제거(SPEC-MOBILE-003)").
   - Google OAuth **시스템 브라우저 인터셉트 방식**(MOBILE-001 의 `onShouldStartLoadWithRequest` authorize URL 인터셉트)은 **SPEC-MOBILE-004 에서 실패 확인 후 `auth:google-request` bridge command 방식으로 대체**됨(MOBILE-004 completed).
   - 따라서 MOBILE-001 의 device-gated 잔여(R-P2/OD-2 — OAuth-intercept 흐름 종단 검증)는 **그 흐름이 더는 존재하지 않아 moot**.

3. **SPEC-MOBILE-002 / WEBVIEW-SHELL-001 의 파운데이션은 유효하며 현행 코드의 기반**이다(토큰 브리지·WebViewShell). 디바이스 최종 검증(AC-V3/AC-S3)만 공식적으로 안 닫혔다. 이들 파운데이션은 **MOBILE-003 의 "iOS 핵심 플로우 디바이스 검증 완료"** 및 MOBILE-004 의 iOS 시뮬레이터 라이브 E2E(2026-06-17)에서 사실상 함께 행사(exercise)됐다.

## 권고 (사용자 결정 필요)

- **SPEC-MOBILE-001 → `completed` 또는 `superseded` 로 종료 권장**: 원 구현(App.tsx + OAuth-intercept)이 MOBILE-003/004 로 대체됨. 남은 device-gated 항목은 사라진 흐름에 대한 것이라 검증 불필요. HISTORY 에 "MOBILE-003/004 로 대체 — superseded" 명기 후 종료.
- **SPEC-MOBILE-002 / WEBVIEW-SHELL-001 → `completed` 종료 후보**: 파운데이션이 MOBILE-003(핵심 플로우 디바이스 검증 완료) + MOBILE-004(iOS 라이브 E2E)에서 행사됨. AC-V3/AC-S3 를 그 검증으로 충족 처리할지 사용자 판단. (cookie-resurrection 결함은 MOBILE-002 v0.2.1 에서 이미 수정·디바이스 재현 검증됨.)
- **자율 루프에서는 status 미변경**: foundational SPEC 의 공식 종료(특히 device-gated AC 충족 판정)는 사용자/디바이스 확인 사안 — 임의 전환하지 않음(정직성·mobile-spec-device-gated).

## 다음 행동(깨어난 뒤)

1. 위 권고대로 MOBILE-001(superseded) / MOBILE-002 / WEBVIEW-SHELL-001 종료 여부 결정.
2. 종료 시: 각 spec.md HISTORY 에 종료 사유(대체/검증 충족) 추가 + status 전환 + tech.md 패키지 status 줄 갱신. (원하면 manager-docs 위임 가능.)
