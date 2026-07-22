# SPEC-WEB-STORYBOOK-001 — Acceptance Criteria

> 각 AC 는 spec.md 의 EARS 요구와 1:1(AC-SB-00N ↔ REQ-SB-00N). 제약: web 앱 무회귀 + 새 토큰/색 발명 0 + 기존 콜사이트 무이관. 목적 = 컴포넌트 카탈로그/문서화.
> **검증 채널 = 전부 AUTO(정적/빌드 게이트)** — apps/web 무 테스트 하네스라 유닛 러너 없음(plan §5). 본 SPEC 은 web 빌드 타임 SPEC 이므로 **디바이스 게이트 불요**(모바일 WebView SPEC 아님).
> **검증 커맨드(공통)**: `pnpm --filter @moyura/web build-storybook` · `pnpm --filter @moyura/web build` · `pnpm --filter @moyura/web lint`. (Storybook 스크립트는 M1 에서 추가됨을 전제.)

---

## M1. Storybook 인프라 배선

### AC-SB-001 ↔ REQ-SB-001 (react-vite 빌더 + 코어-only 툴링)
- **Given** `apps/web` 에 Storybook 이 전무(스크립트·의존성 0)
- **When** Storybook 워크스페이스를 `@storybook/react-vite` 빌더로 추가한다
- **Then** `apps/web/.storybook/main.ts` 의 framework 필드가 `'@storybook/react-vite'` 이고, `package.json` 에 `build-storybook`(및 dev `storybook`) 스크립트가 존재한다.
- **And Then** 툴링이 **코어 only** — `@storybook/addon-a11y`, `@storybook/test-runner`, 시각회귀(Chromatic 등), 새 테스트 프레임워크가 `package.json`/`main.ts addons` 에 **부재**한다(Unwanted).
- **And Then [구현 중 확인 CP-1]** 5 primitive 중 `next/image`/`next/link`/`next/font`/`next/router` 를 요구하는 것이 없음을 재확인했고(요구 시 nextjs-vite 전환), 이 판단이 plan §4 CP-1 과 일치한다.
- **검증(AUTO)**: `build-storybook` 성공(exit 0); `grep -q "@storybook/react-vite" apps/web/.storybook/main.ts`; `package.json` scripts 에 `build-storybook` 존재; a11y/test-runner/visual 애드온 의존성 부재(`package.json` 검사); primitive 파일에 `next/` import 부재(`grep`).

### AC-SB-002 ↔ REQ-SB-002 (preview 가 실 디자인 시스템 렌더 + alias/Tailwind v4 배선)
- **Given** 디자인 시스템 SoT = `apps/web/app/globals.css`(`:root` 토큰 + `@theme` 유틸 + `@utility` gradient)
- **When** `.storybook/preview.tsx` 를 배선한다
- **Then** preview 가 `import "../app/globals.css"` 를 포함하고, 스토리가 실제 Tailwind v4 유틸(`bg-primary`/`rounded-2xl`/`bg-gradient-brand`)로 스타일되어 렌더된다(스타일 없는 렌더 = 회귀 신호).
- **And Then** Storybook Vite 빌드가 `@/*` alias 를 해석하고(빌드 실패 없음), `postcss.config.mjs`(`@tailwindcss/postcss`)로 Tailwind v4 를 처리한다.
- **And Then [구현 중 확인 CP-2/CP-3]** postcss auto-load 실패 시 `@tailwindcss/vite` 폴백, alias 실패 시 `viteFinal`/`vite-tsconfig-paths` 를 적용해 최종 `build-storybook` 이 성공한다.
- **검증(AUTO)**: `grep -q "globals.css" apps/web/.storybook/preview.tsx`; `build-storybook` 성공; 빌드 산출물에 Tailwind 유틸 CSS 가 포함됨(스토리 스타일 적용 — 렌더 무에러로 판정, 필요 시 빌드 CSS 에 `--primary`/`gradient-brand` 존재 grep).

---

## M2. UI Primitives

### AC-SB-003 ↔ REQ-SB-003 (5 canonical presentational primitive)
- **Given** 공유 `components/` 부재, 반복 근거(button 21파일·rounded-2xl 103회·rounded-full 60회·input 28회·gradient-brand 25파일 — research §1.3)
- **When** primitive 를 추출한다
- **Then** `apps/web/components/ui/` 에 `button.tsx`, `card.tsx`, `avatar.tsx`, `input.tsx`, `badge.tsx` 5개가 존재하고, 각자의 props/variants 가 관측된 반복 패턴에서 도출된다(예: Button variant primary/gradient·secondary·ghost·destructive + size + loading/disabled; Input label·error·disabled; Badge tone; Avatar size·fallback; Card surface·slot).
- **And Then** 각 primitive 가 **presentational only** — 데이터 fetching/네트워크/`next/*`/`supabase`/`@/lib/native-bridge` import 가 **없다**(standalone 렌더 보장).
- **And Then** primitive 가 기존 토큰을 Tailwind 유틸로 소비하고 **신규 토큰/색을 만들지 않는다**(globals.css 무변경 — Unwanted).
- **검증(AUTO)**: 5 파일 존재(`ls apps/web/components/ui/{button,card,avatar,input,badge}.tsx`); 각 파일에 `next/`·`supabase`·`native-bridge` import 부재(`grep`); `globals.css` diff 없음(무변경); `lint` clean; `build-storybook` 성공(primitive 컴파일).

---

## M3. Stories

### AC-SB-004 ↔ REQ-SB-004 (primitive 별 variant/state 스토리)
- **Given** 5 primitive(AC-SB-003) + preview 디자인 시스템(AC-SB-002)
- **When** Storybook 을 빌드한다(`build-storybook`)
- **Then** `apps/web/components/ui/{button,card,avatar,input,badge}.stories.tsx` 5개가 존재하고, 각 스토리가 해당 primitive 의 variant/state 를 문서화한다(Button 의 variant·size·loading·disabled; Input 의 default·error·disabled; Badge tone 등).
- **And Then** 모든 스토리가 preview 의 실 디자인 시스템으로 **렌더 에러 0** 이다.
- **And Then** 스토리가 CSF(`Meta`/`StoryObj` 타입) 이고, play-function 인터랙션 러너/새 테스트 러너를 요구하지 않는다.
- **검증(AUTO)**: 5 stories 파일 존재; `build-storybook` 성공(전 스토리 인덱싱·컴파일·렌더 무에러 — 빌드가 스토리 렌더 실패 시 fail); 스토리에 `@storybook/test-runner`/`play` 인터랙션 러너 의존 부재(`grep`).

---

## M4. Design Tokens (SD-1 = 연기 확정 — option B 바인딩)

> **SD-1 RESOLVED (2026-07-22, v0.1.1): 연기(option B).** 아래 option B 가 본 SPEC 의 **바인딩 기준**이다. option A(design-tokens 패키지 지금 생성)는 **본 SPEC 범위 밖(N/A — 후속 SPEC)**.

### AC-SB-005 ↔ REQ-SB-005 (globals.css 시맨틱 토큰 소비, 패키지 비생성)
- **[BINDING — option B (연기 확정)]**
  - **Given** 오늘 토큰 SoT = globals.css `:root` + `@theme inline`(primitive 는 Tailwind 유틸로 이미 토큰 소비)
  - **When** 5 primitive 를 스타일링한다
  - **Then** primitive 가 globals.css 시맨틱 토큰을 Tailwind 유틸(`bg-primary`/`bg-card`/`text-primary-foreground`/`rounded-2xl`/`bg-gradient-brand` 등)로 소비하는 것으로 "토큰 소비(단일 값 소비원)" 를 충족한다.
  - **And Then** `packages/design-tokens` 를 **만들지 않는다**(본 SPEC 범위 밖 — 후속 SPEC).
  - **And Then** primitive 가 토큰과 중복되는 인라인 hex 색/radius 를 하드코딩하지 않는다(dual-source drift 방지, 단일출처 globals.css 보존).
  - **And Then** globals.css 는 **무변경**이다(신규 토큰/색 발명 0).
  - **검증(AUTO)**: primitive 가 시맨틱 토큰 유틸(`bg-primary`/`bg-card`/`text-primary-foreground`) 사용(`grep`); `packages/design-tokens` **미존재**(`ls` 부재 확인); 토큰 중복 인라인 hex 색 부재(`grep -E "#[0-9a-fA-F]{6}"` 로 확인 — GoogleIcon 류 브랜드 SVG 예외); globals.css git diff 없음(무변경).
- **[N/A — option A (지금 생성): 본 SPEC 범위 밖]**
  - `packages/design-tokens` 를 지금 만들어 globals.css 값을 추출·소비하는 안은 **SD-1 에서 연기로 확정**되어 본 SPEC 에서 검증하지 않는다. RN 이 실제 착수될 때 후속 SPEC 이 토큰-프로젝션(값 추출 + 값→CSS 변수 자동 생성)을 도입하며, 그 SPEC 에서 별도 AC 로 검증한다.

---

## M5. 회귀 보존 + Composition 문서화

### AC-SB-006 ↔ REQ-SB-006 (web 앱 무회귀 + 빌드 타깃 분리)
- **Given** 기존 web 앱(라우트·번들·런타임) + colocate 컴포넌트
- **When** Storybook + primitive 를 추가한다
- **Then** `pnpm --filter @moyura/web build`(`next build`)가 무회귀로 성공하고, `pnpm --filter @moyura/web lint`(eslint)가 clean 이다.
- **And Then** 기존 라우트 colocate 컴포넌트와 `globals.css` 가 **무변경**이다(강제 이관 없음 — 대표 1~2개 OPTIONAL 제외).
- **And Then** Storybook 빌드 타깃이 Next 빌드와 분리되어 web 런타임/번들에 영향이 없다(devDeps 추가만).
- **And Then** 새 async 코드가 있으면 에러 핸들링을 포함한다(전역 규칙 — primitive 는 대체로 async 없음).
- **검증(AUTO)**: `build`(next build) exit 0(무회귀); `lint` clean(0 에러); 기존 `app/**`·`globals.css` git diff 없음(OPTIONAL 대표 이관 제외); Next 빌드 산출물에 storybook 청크 부재.

### AC-SB-007 ↔ REQ-SB-007 (Composition 목표 아키텍처 문서화만)
- **Given** 미래 RN 확장 + 토큰-only 공유 전략
- **When** SPEC 을 작성한다
- **Then** spec.md/plan.md 가 root Storybook Composition 목표 형태를 문서화한다 — per-app 홈(web=`apps/web/components/ui/`, 미래 RN=`apps/mobile/components/ui/`) + `refs`(현재 web 1개) + 토큰-only 공유(구현은 플랫폼별, research §1.4/§6).
- **And Then** RN Storybook·`apps/mobile/components/ui/`·root Composition 호스트를 **구현하지 않는다**(design-only, 구현 범위 밖).
- **검증(문서)**: spec.md Non-Goals + REQ-SB-007 + research §6 에 Composition 아키텍처 문서화 존재; `apps/mobile/components/ui/`·root `.storybook` 미생성(구현 부재 확인).

---

## 엣지 케이스

- **EC-1 (Tailwind v4 배선 실패)** ← AC-SB-002: `build-storybook` 시 스토리가 스타일 없이 렌더되면(postcss auto-load 미작동) `@tailwindcss/vite` 폴백을 `viteFinal` 에 적용해 재검증. 폴백으로도 실패 시 SD/리스크로 에스컬레이트(사용자 협의).
- **EC-2 (`@/*` alias 미해석)** ← AC-SB-002: primitive/스토리의 `@/` import 가 빌드 실패를 유발하면 `viteFinal` alias 배선 또는 primitive self-contained 화(‘@/’ 제거).
- **EC-3 (Next 16 + nextjs builder 필요)** ← AC-SB-001: 만약 어떤 primitive 가 `next/image` 등을 반드시 요구하면 react-vite 로는 렌더 불가 → `@storybook/nextjs-vite` 전환(CP-1). 단 5 primitive 는 미의존이 확인됨(research §1.3).
- **EC-4 (SD-1 확정됨)** ← AC-SB-005: SD-1 은 **연기(option B)로 확정**(2026-07-22 v0.1.1). `packages/design-tokens` 미생성 + globals.css 시맨틱 토큰 소비가 바인딩 기준. run 단계 사용자 재확인 불요. 만약 구현 중 토큰 패키지가 필요하다는 판단이 서면 **먼저 사용자에게 묻고**(무단 신설 금지), 원칙적으로 후속 SPEC 으로 분리.
- **EC-5 (scope creep — 콜사이트 이관)** ← AC-SB-006: primitive 도입 후 100+ 콜사이트를 교체하고 싶어도 **하지 않는다**(대표 1~2개 OPTIONAL 초과 금지). 이관은 후속 SPEC.
- **EC-6 (하네스 도입 유혹)** ← plan §5: 스토리 검증을 위해 test-runner/vitest 를 설치하고 싶어도 **먼저 사용자에게 묻는다**(무단 설치 금지 — web-no-test-harness).

---

## Definition of Done

- [ ] **인프라(AC-SB-001/002)**: `@storybook/react-vite` 빌더 + `main.ts`/`preview.tsx` 배선 + `build-storybook` 스크립트; preview 가 `globals.css` import; 코어-only 툴링(a11y/test-runner/visual 부재); `@/*` alias + Tailwind v4 배선으로 `build-storybook` 성공.
- [ ] **Primitives(AC-SB-003)**: `components/ui/{button,card,avatar,input,badge}.tsx` 5개, presentational only(데이터/`next/*`/bridge import 0), 기존 토큰 소비(신규 토큰 0).
- [ ] **Stories(AC-SB-004)**: 5 `*.stories.tsx`, variant/state 문서화, 실 디자인 시스템 렌더 에러 0, CSF(러너 없음).
- [ ] **Tokens(AC-SB-005, SD-1=연기 확정)**: primitive 가 globals.css 시맨틱 토큰(Tailwind 유틸)을 소비 + `packages/design-tokens` **미생성**(후속 SPEC) + 토큰 중복 인라인 hex 색/radius 하드코딩 0 + globals.css 무변경. option A(패키지 지금 생성)는 본 SPEC 범위 밖.
- [ ] **무회귀(AC-SB-006)**: `next build` 무회귀 + `eslint` clean + 기존 `app/**`·globals.css 무변경(OPTIONAL 대표 이관 제외) + 빌드 타깃 분리.
- [ ] **Composition 문서화(AC-SB-007)**: 목표 아키텍처 문서화만, RN/ root 호스트 구현 0.
- [ ] **AUTO 게이트 전수 통과**: `pnpm --filter @moyura/web build-storybook`(스토리 렌더 0 에러) + `pnpm --filter @moyura/web build`(무회귀) + `pnpm --filter @moyura/web lint`(clean).
- [ ] **완료 정책**: AUTO 게이트 통과 시 status draft→completed(**디바이스 게이트 불요** — web 빌드 타임 SPEC). SD-1=연기 확정이므로 M4 는 globals.css 토큰 소비만(design-tokens 패키지 후속 SPEC). 하네스·러너 무단 도입 0.
