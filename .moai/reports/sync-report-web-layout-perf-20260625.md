# 문서 동기화 리포트 — 웹 레이아웃 재설계 + 웹 성능 (2026-06-25)

동기화 범위: 직전 docs(sync) `51061f0` → `HEAD` `7303931`.

## 대상 커밋

| 커밋 | 종류 | 요약 |
|------|------|------|
| `7303931` | refactor(web) | 문서 스크롤 + fixed 바텀탭 전환 (레이아웃 재설계 NET 최종) |
| `314e430` | fix(web) | svh 앱셸 내부 스크롤 회귀 수정 (중간 반복 — 최종에 흡수됨) |
| `d66ceae` | fix(web) | 앱셸 높이 %→svh (중간 반복 — 최종에 흡수됨) |
| `2374bb8` | chore(mobile) | EAS 로컬 빌드용 google-services 경로 + `production-local` 프로파일 |
| `8793916` / `eed11f5` | perf(web) | supabase-js 지연 로드 (번들/hydration 축소) |
| `a0b5852` | docs(web) | supabase 지연 로드 before/after 측정 결과 (리포트) |
| `2a65f55` / `d52bacd` | perf(web) | SSR 전환 지연 개선 (리전 sin1 + getMe dedup + loading.tsx) |
| `d88d051` | docs(web) | 페이지 전환 성능 진단·개선 리포트 |

## 동기화한 항목

### 1. 웹 모바일 브라우저 레이아웃 재설계 (NET 최종 상태)

고정 높이 `svh` 앱셸(내부 `overflow-y-auto`) → **document-scroll + `position:fixed` 바텀탭**.

- `body min-h-dvh`, `(main)`/`moims` 셸 normal-flow, 페이지 내부 `overflow-y-auto` 제거 + 헤더 `sticky top-0`
- `BottomTabBar` `fixed inset-x-0 bottom-0 z-40` + `env(safe-area-inset-bottom)`
- 루트 `viewport-fit=cover`(safe-area inset 실효화), 콘텐츠 `pb-bottom-tab` 클리어런스, 네이티브 셸 phantom 여백 reset(`data-bottom-tab-spacer`)
- 효과: document-scroll 로 모바일 브라우저 크롬 접힘 + `fixed` 탭은 스크롤 캔버스 밖이라 비잘림
- 채팅 페이지 예외: `h-dvh-fixed` 내부 스크롤 유지(입력 핀 고정 UX)
- 한 세션 3차 반복(`d66ceae` → `314e430` → `7303931`) — 중간 svh 접근을 supersede, CHANGELOG 에는 NET 최종만 기록

**프레이밍(중요)**: Vercel 배포는 완료됐으나 **실기기 검증 대기**. fixed-bottom + 동적 툴바는 기기/브라우저 민감(iOS Safari[iOS 26 caveat 포함], Android Chrome, 네이티브 WebView)으로 "동작 확정"이 아닌 "구현·배포됨, 실기기 검증 대기"로 명시.

### 2. EAS 로컬 빌드 google-services 주입 (`2374bb8`)

`eas build --local` 은 EAS secret-visibility 클라우드 env(`GOOGLE_SERVICES_JSON`/`PLIST`)가 적용되지 않음 → 로컬 파일에서 주입하도록 보강.

- `local`/`local-sim`: `../credentials/google-services.dev.json`·`GoogleService-Info.dev.plist`(dev 자격증명)
- 신규 `production-local`(`extends production`): prod google-services 로컬 경로(`../credentials/google-services.json`·`GoogleService-Info.plist`)
- 클라우드 `production` 프로파일 무변경(여전히 클라우드 secret 사용)
- (소스 대조 검증 완료 — eas.json 실파일과 일치)

### 3. 웹 supabase-js 지연 로드 (`8793916`)

`@supabase/supabase-js`(realtime 포함 ~238KB)가 root layout 체인으로 전역 로드되던 문제 해소. `NativeBridgeProvider`/`ShellSessionAnnouncer` 를 `window.ReactNativeWebView` 가드 후 `import("./bridge-client")` dynamic import 로 전환. bridge-client 내부 로직/보안 불변(로딩 방식만 변경). `/home` First Load JS 의 supabase chunk 참조 1→0, realtime 라우트 유지.

### 4. 웹 SSR 전환 지연 개선 (`2a65f55`)

- Vercel 함수 리전 `regions=["sin1"]`(Singapore — 백엔드 Render 리전 정렬, 인트라리전 호출)
- `requireNamedSession` React `cache()` 래핑(요청당 `GET /me` 1회 dedup)
- `(main)/`·`home/[id]/`·`expenses/` `loading.tsx` 추가(전환 즉시 스켈레톤)
- per-user 데이터는 교차 누수 방지를 위해 의도적으로 미캐싱

## 수정 파일

| 파일 | 변경 |
|------|------|
| `CHANGELOG.md` | `[Unreleased]` — Changed 3건(레이아웃 재설계·supabase 지연 로드·SSR 전환 perf) + Added 1건(EAS production-local) |
| `.moai/project/tech.md` | web 프레임워크 셀에 레이아웃/스크롤 모델·viewport-fit·sin1·supabase-js 지연 로드 추가; eas.json 프로파일 목록에 production-local 추가; 파일 위치 표에 vercel.json 추가 |
| `.moai/project/structure.md` | eas.json 트리 노드에 production-local 추가; `(main)/` 레이아웃 셀에 document-scroll + fixed 바텀탭 스크롤 모델 + loading.tsx 추가 |
| `.moai/reports/sync-report-web-layout-perf-20260625.md` | 본 리포트 |

## 프로덕션 소스 무변경

본 동기화는 문서만 수정했다. `apps/web`/`apps/mobile` 등 프로덕션 소스 코드는 변경하지 않았다.

## 검증

- 문서에 기재한 모든 소스 사실을 실파일과 대조 검증: `eas.json`(production-local·EAS_BUILD_PROFILE·dev/prod google-services 경로), `vercel.json`(`regions=["sin1"]`), `globals.css`(`pt-page`/`h-dvh-fixed`/`pb-bottom-tab`), `layout.tsx`(`viewport-fit=cover`).
- 레이아웃 재설계 CHANGELOG 항목은 "구현·배포됨(Vercel), 실기기 검증 대기" 프레이밍 사용(verified 아님).

## 발견했으나 수정하지 않은 드리프트

- `tech.md` 라인 21(SPEC-WEB-VIEWPORT-001)은 `app/layout.tsx` viewport 메타(maximumScale/userScalable)만 다룬다. 이번에 추가된 `viewport-fit=cover` 는 같은 layout.tsx 의 viewport 객체에 속하지만, 본 동기화에서는 레이아웃/스크롤 모델 맥락(web 프레임워크 셀)에만 기록했다 — 두 서술이 같은 파일을 가리키나 중복/충돌은 아님(별도 관심사). 별도 SPEC sync 시 SPEC-WEB-VIEWPORT-001 항목과 통합 검토 가능.
