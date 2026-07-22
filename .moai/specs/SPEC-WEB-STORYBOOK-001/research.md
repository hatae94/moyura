# SPEC-WEB-STORYBOOK-001 — Research (코드베이스 분석 + 빌더/버전 검증)

> 본 문서는 SPEC 의 근거다. 코드베이스 사실은 직접 확인(2026-07-22), 외부 버전/호환성 주장은 전부 WebFetch 로 URL 검증(하단 Sources). 검증되지 않은 버전 호환성은 "확정"으로 서술하지 않는다(anti-hallucination 정책).

---

## 1. 현 코드베이스 (직접 확인 — 2026-07-22)

### 1.1 모노레포 / 웹 스택

- 모노레포: **pnpm workspace(`pnpm@10.27.0`) + Nx(`21.6.7`)**. `pnpm-workspace.yaml` packages = `apps/*`, `packages/*`. 현재 `packages/` = `api-client`, `config` 두 개만(디자인 관련 패키지 없음).
- `apps/web` = **Next.js 16.2.6, React 19.2.4, react-dom 19.2.4**, Tailwind CSS v4(`@tailwindcss/postcss ^4`, `tailwindcss ^4`), `babel-plugin-react-compiler 1.0.0`, `eslint ^9` + `eslint-config-next 16.2.6`, TypeScript `^5`.
- `apps/web/package.json` scripts: `dev`(next dev) / `build`(next build) / `start` / `lint`(eslint). **Storybook 미존재**(스크립트·의존성 0).
- `apps/web/project.json`(nx) targets: `dev`/`build`/`start`/`lint`/`typecheck`(`tsc --noEmit`, `dependsOn: api-client:generate`). App Router = `apps/web/app/`.
- TS path alias: `@/*` → `apps/web` 루트(`tsconfig.json` `paths`). `moduleResolution: bundler`, `jsx: react-jsx`.
- `next.config.ts`: `reactCompiler: true`, `transpilePackages: ["@moyura/api-client"]`, `turbopack.root` = 모노레포 루트, `allowedDevOrigins`(LAN IP). → **Next 빌드는 Turbopack + React Compiler(babel plugin)** 경로.

### 1.2 디자인 시스템 위치 (토큰 단일출처 = globals.css)

`apps/web/app/globals.css`(Tailwind v4 CSS-first):
- `@import "tailwindcss";` (v4, `tailwind.config.js` 없음 — CSS-first 설정).
- `:root` 에 **시맨틱 토큰을 CSS 변수로 선언** — `--primary:#ff5436`, `--primary-foreground:#ffffff`, `--background:#fafafa`, `--foreground:#18181b`, `--card:#ffffff`, `--secondary:#fff1ec`, `--muted:#f1f1f3`, `--muted-foreground:#8e8e93`, `--accent`, `--destructive:#ed4956`, `--border:rgba(0,0,0,0.07)`, `--input-background:#f1f1f3`, `--ring:#ff5436`, `--radius:1rem`, 그라데이션(`--gradient-brand`, `--gradient-brand-pan`, `--gradient-brand-soft`), easing(`--ease-spring`, `--ease-smooth`).
- `@theme inline { ... }` 로 위 CSS 변수를 **Tailwind v4 유틸로 노출**(`bg-primary`, `text-primary-foreground`, `bg-card`, `rounded-lg`, `--radius-sm/md/lg/xl` 등).
- 커스텀 `@utility`: `pt-page`, `h-dvh-fixed`, `pb-bottom-tab`, `content-auto-card/poll/member`(SPEC-WEBVIEW-NATIVE-FEEL-001 M5), `bg-gradient-brand`, `bg-gradient-brand-animated`, `bg-gradient-brand-soft`, `text-gradient-brand`, `@keyframes`(fade-in/scale-in 등).
- **결론**: 오늘 웹의 토큰 단일출처(SoT)는 `globals.css :root` + `@theme inline` 이다. primitive 를 Tailwind 유틸(`bg-primary`/`rounded-2xl`/`bg-card`)로 스타일링하면 **이미 이 토큰을 소비**한다 — 별도 토큰 패키지 없이도 "토큰 소비"가 성립한다(§5 서브결정 근거).

### 1.3 컴포넌트 현황 — 공유 `components/` 부재, 라우트 폴더 내 colocate

- `apps/web/components/` **디렉터리 없음**. 컴포넌트는 라우트 폴더에 colocate(`app/(main)/_components/`, `app/login/login-form.tsx`, `app/moims/new/create-moim-form.tsx`, `app/(main)/home/[id]/*-section.tsx` 등). `apps/web/app` 하위 `.tsx` = **49개**(+`apps/web/lib` 일부).
- 반복 근거(grep 검증 — primitive 추출 정당화):
  | 패턴 | 측정값 | 대응 primitive |
  |------|--------|----------------|
  | `<button` (파일) | **21 파일** | `Button` |
  | `gradient-brand` (파일) | **25 파일** | `Button`(primary/gradient variant) |
  | `rounded-2xl` (occurrence) | **103 회** | `Card` 표면 |
  | `rounded-full` (occurrence) | **60 회** | `Avatar`/`Badge`/icon-button |
  | `<input` (occurrence) | **28 회 / 10 파일** | `Input` |
  | badge/pill (좁은 패턴 `rounded-full…text-xs`) | 4~11 파일(패턴 다양) | `Badge` |
- 대표 추출 소스(존재 확인): `app/(main)/_components/BottomTabBar.tsx`, `app/login/login-form.tsx`(button/input/GoogleIcon), `app/moims/new/create-moim-form.tsx`, `app/(main)/home/[id]/{polls,members}-section.tsx`.
- **결론**: 5 primitives(Button/Card/Avatar/Input/Badge)는 반복 근거가 뒷받침한다. primitive props/variants 는 신규 발명이 아니라 **관측된 반복 패턴**에서 도출한다.

### 1.4 모바일(공유 불가 근거)

- `apps/mobile` = Expo `~56.0.6`, expo-router, react-native `0.85.3`, **nativewind 없음**. → RN 은 primitives + `StyleSheet`(className 아님).
- web(`react-dom` + Tailwind className) 과 mobile(RN primitives + `StyleSheet`) 은 **컴포넌트 구현 코드를 직접 공유 불가**. 진짜 코드 공유는 `react-native-web` + 기존 웹 앱 재작성이 필요(고비용 — 기각). → **토큰(값)만 공유 + 구현은 플랫폼별 + Storybook Composition 으로 통합**이라는 아키텍처의 근거.

---

## 2. 빌더 결정 — `@storybook/react-vite` vs `@storybook/nextjs(-vite)`

### 2.1 검증된 버전 사실(WebFetch)

- Storybook 현재 메이저 = **v10.x(문서 상단 "Version 10.5")**. 최소 **Node.js 20+**. 설치 = `npm create storybook@latest`(≤8.3 은 `npx storybook@X init`). (Context7 색인 버전 목록도 `v9.0.15`, `v10.2.9` 노출 — v9/v10 병존, v10 이 현재.)
- `@storybook/react-vite`: **React ≥ 16.8**, framework 필드 `'@storybook/react-vite'`. React 19 는 이 범위에 포함되나 **docs 가 "React 19" 를 명시적으로 호출하지는 않음**(정직 갭 — §4).
- Next 프레임워크 옵션 **2종**: `@storybook/nextjs`(Webpack 5 기반, **Next ≥ 14.1**) / `@storybook/nextjs-vite`(Vite 기반, "대부분의 Next 프로젝트에 권장"). docs 는 **Next 16 을 명시하지 않음**(Next 16 은 매우 신규 — 프레임워크 지원 랙 리스크).

### 2.2 결정 매트릭스

| 옵션 | 장점 | 단점 / 리스크 | 5 primitives 적합성 |
|------|------|---------------|---------------------|
| **`@storybook/react-vite` (권장)** | 경량·빠름; Next 프레임워크 지원 랙(Next 16)과 **디커플링**; Vite 가 `postcss.config.mjs` auto-load → Tailwind v4 그대로; presentational primitive 에 충분 | `next/image`/`next/link`/`next/font`/`next/router` 미지원(primitive 가 next 기능 쓰면 깨짐); `@/*` alias·React Compiler 는 Storybook Vite 에서 별도 배선 필요 | **높음** — 5 primitive 는 next/* 미의존(§1.3 확인) |
| `@storybook/nextjs-vite` | next/* 기능 지원(image/font/link) + Vite 속도; Next 프로젝트 공식 권장 | Next 프레임워크 버전 추적 필요(Next 16 명시 부재 → bleeding-edge 리스크); 5 primitive 엔 오버스펙 | 중간 — next 기능 불필요 |
| `@storybook/nextjs` | 커스텀 Webpack/Babel 호환 | Webpack 기반(무거움); Turbopack/React Compiler 스택과 불일치 | 낮음 |

- **권장 = `@storybook/react-vite`**. 근거: (1) 5 primitive 는 `next/image`/`next/link`/`next/router` 미의존(§1.3), (2) Next 16 은 신규라 `@storybook/nextjs(-vite)` 의 프레임워크 지원이 뒤따르지 않을 위험, (3) Tailwind v4 는 Vite 의 postcss auto-load 로 그대로 동작(§3).
- **에스컴 해치**: 향후 어떤 primitive 가 next 기능(image 최적화·next/font)을 요구하면 `@storybook/nextjs-vite` 로 전환(§5 구현 중 확인 체크포인트).

---

## 3. Tailwind v4 + Storybook(Vite) 배선

### 3.1 검증된 사실(WebFetch)

- Tailwind v4 Next 가이드: PostCSS 플러그인 = **`@tailwindcss/postcss`**, `postcss.config.mjs` = `{ plugins: { "@tailwindcss/postcss": {} } }`, CSS = `@import "tailwindcss";`, **CSS-first(`tailwind.config.js` 불필요)**. → web 현 설정과 정확히 일치(§1.2).
- Storybook Tailwind recipe: Vite/Next/CRA/Angular 는 "PostCSS 이미 설정됨". Tailwind 를 스토리에 노출하려면 **CSS 파일을 `.storybook/preview` 에 import**. (단, 이 recipe 페이지는 **Tailwind v3 기준** — v4/`@tailwindcss/postcss` 는 명시 미포함. 정직 갭 — §4.)

### 3.2 배선 설계(근거 기반)

- `@storybook/react-vite` 는 자체 Vite 를 구동한다. Vite 는 프로젝트 루트의 `postcss.config.mjs` 를 **자동 로드**한다 → `.storybook/preview.tsx` 에서 `import "../app/globals.css"` 하면 `@tailwindcss/postcss` 가 CSS 를 처리하고 `@theme`/`@utility`/그라데이션/`:root` 토큰이 스토리에 그대로 적용된다.
- Tailwind v4 자동 content 감지가 `components/ui/*.tsx` + `*.stories.tsx` 의 클래스를 스캔한다(v4 는 content 배열 불필요).
- `@/*` alias: Storybook Vite 는 tsconfig paths 를 자동 이해하지 못하므로 `.storybook/main.ts` 의 `viteFinal` 에서 alias 배선(또는 `vite-tsconfig-paths` 플러그인) 필요 — **구현 중 확인 항목**. (primitive 를 self-contained 로 만들어 `@/` import 를 최소화하면 리스크 축소.)
- 폴백: PostCSS auto-load 가 실패하면 `@tailwindcss/vite` 플러그인을 `viteFinal` 에 추가하는 대안 존재(v4 first-party Vite 플러그인). **구현 시 실측으로 확정**.

---

## 4. 정직성 노트 (검증 갭 — "확정"으로 서술하지 않음)

- **React 19 명시 부재**: Storybook docs 는 `@storybook/react-vite` 최소 React ≥16.8 만 명시하고 "React 19" 를 호출하지 않는다. React 19.2.4 는 범위에 포함되나, "공식 명시 지원" 이 아니라 "최소 버전 범위 내 포함" 으로 서술한다. 실제 확정은 `build-storybook` 성공(구현 게이트)으로 판정.
- **Tailwind v4 recipe 부재**: Storybook 공식 Tailwind recipe 는 v3 예시다. v4 동작은 (a) web 이 이미 `@tailwindcss/postcss` + CSS-first 를 프로덕션에서 사용 중이라는 사실과 (b) Vite 의 postcss auto-load 라는 메커니즘에서 **추론**한 것이며, 최종 확정은 `build-storybook` + 스토리 렌더 실측이다.
- **Next 16 + Storybook Next 프레임워크**: docs 는 Next ≥14.1 만 명시. Next 16 지원은 미검증 → 이 리스크가 react-vite 권장의 핵심 근거다(디커플링).

---

## 5. 서브결정 SD-1 — `packages/design-tokens` 지금 생성 vs 연기 (RESOLVED — 연기)

> **결정(2026-07-22, spec v0.1.1): 연기(option B) — 사용자 확정.** 본 SPEC 은 `packages/design-tokens` 패키지를 만들지 않고, primitive 가 globals.css 시맨틱 토큰(Tailwind 유틸)을 소비한다. 근거: (1) 단일출처(globals.css) 보존, (2) dual-source drift 회피, (3) 1차 SPEC 최소화, (4) RN 토큰-프로젝션은 RN 이 실제 착수될 때 후속 SPEC 으로 도입. 아래 분석은 그 결정의 근거 기록이다.

### 5.1 현 상태의 함의

오늘 web 토큰 SoT = `globals.css :root` + `@theme inline`(§1.2). primitive 를 Tailwind 유틸로 스타일링하면 **이미 토큰을 소비**한다. 즉 web 단독으로는 별도 토큰 패키지가 불필요하다 — 패키지의 유일한 신규 소비자는 **CSS 변수를 못 읽는 미래 RN(StyleSheet)** 이다.

### 5.2 옵션

- **옵션 A(권장 — 지금 최소 생성)**: `packages/design-tokens`(TS/JSON)에 `globals.css :root` 값들을 **그대로 추출**(colors/radius scale/gradient stops/easing/font family — 신규 값 발명 금지). 최소 1개 이상 신규 primitive 가 이 패키지를 소비(AC 충족 — 예: 그라데이션 stop 배열이나 radius 스케일을 non-Tailwind 지점에서 참조). 역할 = (1) AC 의 "토큰이 신규 primitive 의 단일 소비원" 증명, (2) 플랫폼-무관 값 SoT(미래 RN StyleSheet + 선택적 CSS 생성이 소비). **drift 리스크**: globals.css 와 값이 이원화됨 → 단일출처 원칙 위반. **완화**: 패키지를 globals.css 값의 얇은 미러로 두고, "globals.css 는 CSS 프로젝션, 값 생성 자동화(패키지→CSS 변수)는 후속 SPEC" 로 명시. gradient 는 stop 배열로 공유(RN 은 expo-linear-gradient 로 소비 가능).
- **옵션 B(연기 — 더 엄격한 minimal-change)**: 지금은 패키지 미생성. globals.css `@theme` 를 유일 토큰 SoT 로 유지. `packages/design-tokens` 는 **RN Storybook SPEC 이 착수될 때** 신설(CSS 변수를 못 읽는 유일 소비자가 그때 생기므로). 장점 = dual-source drift 0, 사용자 single-source/minimal 선호와 정합. 단점 = RN-준비 구체 산출물 연기.

### 5.3 결정 (RESOLVED)

- **확정 = 옵션 B(연기)** — 사용자 확정(2026-07-22). 최초 초안은 옵션 A(지금 최소 생성)를 권장으로 제시했으나, **dual-source drift** 가 사용자 single-source-of-truth 선호와 충돌한다는 점이 결정적이었다. 따라서 본 SPEC 은 토큰 패키지를 만들지 않고, primitive 가 globals.css 토큰(Tailwind 유틸)을 소비하는 것으로 "토큰 소비"(AC-SB-005 option B)를 충족한다. M4(토큰 패키지) 모듈은 후속 SPEC 으로 이관되며, RN 이 실제 착수될 때 토큰-프로젝션(값 추출 + 값→CSS 변수 자동 생성)을 도입한다. 이 시점에 A 를 채택하면 drift 를 자동화로 방지할 수 있다(수기 미러가 아님).

---

## 6. Composition 목표 아키텍처(설계만 — 구현 범위 밖)

- 미래 root Storybook 이 `refs` 로 web·RN 두 Storybook 을 composition. **지금은 web ref 1개만** 존재(RN Storybook 미착수).
- per-app 컴포넌트 홈: web=`apps/web/components/ui/`, RN=`apps/mobile/components/ui/`(미래, react-native builder 별도).
- 공유 = **디자인 토큰(값)만**. 구현은 플랫폼별(§1.4 근거). 통합 표면 = Composition(`refs`), 코드 공유 아님.
- 본 SPEC 은 이 아키텍처를 **문서화만** 하고 RN Storybook·root 호스트를 구현하지 않는다.

---

## 7. 검증 접근(무 테스트 하네스)

- `quality.yaml development_mode: "tdd"` 이나 **apps/web 은 테스트 하네스 없음**(사용자 반복 거부 — 프로젝트 메모리 web-no-test-harness). → 본 SPEC 검증은 **build/lint/storybook-build 정적 게이트**로만 한다. RED-GREEN 유닛 테스트·새 테스트 러너 도입 금지. plan.md §4 에서 TDD-모드↔무하네스 정합을 명시.

---

## Sources (출처 — 전부 WebFetch 검증 2026-07-22)

- Storybook — Get started / Install(현재 v10.5, Node 20+, `npm create storybook@latest`) — https://storybook.js.org/docs/get-started/install
- Storybook — React & Vite framework(`@storybook/react-vite`, React ≥16.8, framework 필드) — https://storybook.js.org/docs/get-started/frameworks/react-vite
- Storybook — Next.js framework(`@storybook/nextjs` Webpack Next≥14.1 / `@storybook/nextjs-vite` Vite 권장) — https://storybook.js.org/docs/get-started/frameworks/nextjs
- Storybook — Tailwind CSS recipe(preview 에 CSS import; v3 기준, v4 미명시) — https://storybook.js.org/recipes/tailwindcss
- Tailwind CSS — Next.js 설치 가이드(v4 `@tailwindcss/postcss`, `postcss.config.mjs`, `@import "tailwindcss"`, CSS-first) — https://tailwindcss.com/docs/installation/framework-guides/nextjs
- Context7 색인 — `/storybookjs/storybook`(버전 목록 v9.0.15/v10.2.9 — v10 현재 확인용)
- 코드 직접 확인(2026-07-22): `apps/web/package.json`, `apps/web/project.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/postcss.config.mjs`, `apps/web/app/globals.css`, `apps/web/app/login/login-form.tsx`, `pnpm-workspace.yaml`, `package.json`(root), grep 반복 근거.
