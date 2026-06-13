# Sync Report — SPEC-MOBILE-003

생성일: 2026-06-13
브랜치: feature/SPEC-MOBILE-004 (SPEC-MOBILE-003 run이 이 브랜치에서 완료됨)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOBILE-003/spec.md` | 수정 | frontmatter(status/version/updated), HISTORY 항목, R-PR1 기준선, Definition of Done, Implementation Notes 절 추가 |
| `.moai/specs/SPEC-MOBILE-003/acceptance.md` | 수정 | AC-4 기준선, Quality Gates 기준선 |
| `.moai/specs/SPEC-MOBILE-003/plan.md` | 수정 | 단계 G 회귀 게이트 기준선, 리스크 #3 게이트 기준선 |
| `.moai/specs/SPEC-MOBILE-003/spec-compact.md` | 수정 | R-PR1 기준선, AC-4 기준선 |
| `CHANGELOG.md` | 수정 | [Unreleased] > Added에 MOBILE-003 항목 추가 |
| `.moai/project/tech.md` | 수정 | mobile 스택 테이블(expo-router 의존성 추가), IMPLEMENTED 요약 테이블에 SPEC-MOBILE-003 행 추가 |
| `.moai/project/structure.md` | 수정 | mobile 앱 트리(expo-router `app/` 라우트 그룹), web `(main)` 탭 그룹, 워크스페이스 패키지 표, RN 웹뷰 현황 설명 |
| `.moai/reports/sync-report-SPEC-MOBILE-003.md` | 신규 | 본 문서 |

---

## 2. 기준선 수정 (89/89 → 134/134)

총 8곳의 오래된 "89/89" 기준선을 실제 값으로 정정했다.

| 파일 | 수정 위치 | 변경 전 | 변경 후 |
|------|-----------|---------|---------|
| `spec.md` | R-PR1 | 89/89 baseline 이상 유지 | 134/134 이상 — 94 기존 baseline + 40 신규 |
| `spec.md` | Definition of Done | 89/89 baseline 이상 | 134/134 (94+40 명시) |
| `acceptance.md` | AC-4 Then 절 | 89/89 baseline 이상 유지 | 134/134 이상 (94+40) |
| `acceptance.md` | Quality Gates | vitest 89/89 baseline 이상 | vitest 134/134 이상 (94+40) |
| `plan.md` | 단계 G 회귀 게이트 | 89/89+ | 134/134 이상 (94+40) |
| `plan.md` | 리스크 #3 | 89/89 게이트 | 134/134 게이트 |
| `spec-compact.md` | R-PR1 | 89/89 baseline 이상 | 134/134 이상 (94+40) |
| `spec-compact.md` | AC-4 | 89/89+ | 134/134 이상 (94+40) |

**구성**: 40 신규 테스트 = route-map-core 17 + auth-state-core 10 + crossroute 10 + app-lifecycle +3.

---

## 3. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.1`
- **신규 버전**: `0.2.0`
- **이유**: 디바이스 검증 게이트 정책(`mobile-spec-device-gated` 메모리)에 따라 iOS 시뮬레이터 핵심 플로우는 검증됐으나 Google OAuth 라운드트립(실계정), 로그아웃 E2E, Android back 확인이 남아 있어 `completed` 전환 조건 미충족.
- **completed 전환 조건**: 위 3가지 미검증 항목 확인 완료 후 — spec.md Definition of Done 디바이스 게이트 항목 전부 충족.

---

## 4. CHANGELOG 업데이트 요약

`[Unreleased] > Added` 섹션에 MOBILE-003 항목을 WEBVIEW-SHELL-001 항목보다 먼저(최신 순) 삽입했다.

포함 내용:
- expo-router 네이티브 네비게이션 골격 (`app/` 트리 전체)
- 웹 `(main)` 탭 라우트 그룹 + HomeTab(mock 데이터)
- 네이티브 인증 상태(AuthContext) + 라우트 가드
- 라우트별 WebView 래퍼 + 네비게이션 계약(route-map-core, decideWebViewLoad 확장)
- 셸 모드 탭바 숨김(ShellModeEffect + ShellSessionAnnouncer, CSP nonce 수정)
- post-login redirect `/me`→`/home`
- 디바이스 검증 수정 항목(토큰 핸드오버/CSP nonce/soft-nav)
- 의존성 추가(expo-router 등) + @react-native-cookies pnpm patch
- vitest 134/134 구성 명시

---

## 5. structure.md / tech.md 증분 업데이트 요약

### tech.md
- mobile 프레임워크 행: expo-router ~56.2.10, react-native-safe-area-context, react-native-screens, expo-constants 추가(네이티브 네비게이션 골격). @react-native-cookies pnpm patch 기재.
- `App.tsx` 제거 및 expo-router 파일 기반 라우팅으로 전환 명시.
- IMPLEMENTED 요약 테이블에 SPEC-MOBILE-003 행 신규 추가.

### structure.md
- `apps/mobile/app/` 라우트 트리 전체(`_layout`, `index`, `+not-found`, `(auth)/_layout`+`login`, `(tabs)/_layout`+`home`/`explore`/`notifications`/`profile`) 신규 문서화.
- `components/BridgedWebView.tsx` 추가.
- `lib/route-map-core.ts`, `lib/auth/auth-state-core.ts`, `lib/auth/AuthContext.tsx` 추가.
- `patches/` 디렉터리(@react-native-cookies patch) 문서화.
- `apps/web/app/(main)/` 탭 라우트 그룹 + `_components/` 명시.
- 워크스페이스 패키지 표 mobile 행: expo-router 의존성 추가, status in-progress 갱신.
- RN 웹뷰 현황 설명: SPEC-MOBILE-003 구현 내용(ShellSessionAnnouncer, route-map-core, BridgedWebView 등)으로 갱신.

---

## 6. MX 태그 어드바이저리 (비차단)

아래 신규 웹 bridge 파일들은 현재 @MX 태그가 없다.

| 파일 | fan_in 추정 | 비동기 처리 | 권고 |
|------|------------|------------|------|
| `ShellSessionAnnouncer.tsx` (`announceSessionFromCookies`) | 1 (단일 마운트 지점) | try/catch 있음 | P2: @MX:NOTE 권고 — (main) 레이아웃에서만 호출되는 단일 진입점이나, D-V2 수정의 핵심 로직으로 향후 유지보수 시 컨텍스트 전달 유용 |
| `ShellModeEffect.tsx` | 1 (layout에서 마운트) | N/A | P2: @MX:NOTE 선택 — soft-nav 이유 명시 목적 |
| `BridgedWebView.tsx` | 4 (탭 4종) | try/catch 있음 | P1: @MX:ANCHOR 고려 가능 — fan_in=4, 탭 전체의 공유 seam |

**판정**: fan_in < 3(ShellSessionAnnouncer/ShellModeEffect)이고 async 경로에 try/catch 존재 — TRUST 5 기준 P1/P2 비차단. BridgedWebView는 fan_in=4로 향후 @MX:ANCHOR 추가가 권장되나 현재 동작에 영향 없음.

**권고 액션**: 다음 관련 SPEC 작업 시 `BridgedWebView.tsx`에 @MX:ANCHOR, `ShellSessionAnnouncer.tsx`에 @MX:NOTE를 추가하는 것을 고려.

---

## 7. 미검증 항목 (status in-progress 유지 이유)

| 항목 | 이유 | completed 전환 필요 여부 |
|------|------|------------------------|
| Google OAuth 라운드트립 (device) | 실 Google 계정 필요 — 사용자 수동 검증 정책 | 필요 |
| 로그아웃 E2E | 웹 `/me` 로그아웃 UI가 탭 플로우 밖 — 이 SPEC의 네비게이션 범위 내에서 접근 불가 | 필요 |
| AC-6 Android 하드웨어 back | Android 제외 user directive(2026-06-12) — iOS 시뮬레이터만 검증 | 필요 |

---

status: sync complete (SPEC-MOBILE-003 v0.2.0, in-progress)
