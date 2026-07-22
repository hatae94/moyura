## SPEC-WEB-STORYBOOK-001 Progress

- Started: 2026-07-22 (run phase)
- Harness: standard | Mode: focused frontend (single domain, ~14 files)
- Development mode: tdd → 무 테스트 하네스 정합(plan §5): 검증 = build/lint/storybook-build 정적 게이트
- Plan Approval gate: PASS (2026-07-22) — 계획대로 진행, 대표 콜사이트 이관 OFF
- Delegate: expert-frontend (foreground, no worktree — pnpm workspace lockfile 정합)

### 결정 고정 (run 재확인 불요)
- SD-1: 연기(option B) — packages/design-tokens 비생성, globals.css 시맨틱 토큰 소비
- SD-2: react-vite 빌더(구현 중 CP-1 재확인 — next/* 미의존)
- SD-3: nx build-storybook 타깃 추가
- 콜사이트 이관: OFF (Non-Goal 준수)

### Phase log
- Phase 1 complete: strategy from plan.md (approved, no re-plan)
- Phase 2 complete: expert-frontend 구현 (SB 10.5.3, 5 primitive + 5 stories, +cn.ts helper)
- Phase 2.5/2.8 complete: 독립 게이트 검증 PASS — build-storybook(렌더 0에러, 토큰 CSS 실주입) · next build 무회귀 · eslint clean · 정적 제약(presentational/코어-only/무 hex/globals.css 무변경/design-tokens 미생성) 전수 통과
- Phase 2.9 complete: @MX:NOTE 배치(preview/main/각 primitive)
- Status: draft → completed (v0.2.0). 남은 것: git commit(local-only) + optional /moai sync
- Tailwind v4 배선 실측: Vite postcss auto-load(폴백 불요) / @/ alias = viteFinal
- Deviation: components/ui/cn.ts(classname helper) + eslint.config.mjs(storybook-static ignore 1줄) — 둘 다 최소·정당
- Post-fix (브라우저 실검증, chrome-devtools): build-storybook 통과에도 hook 사용 primitive(Avatar useState / Input useId)가 런타임 "Invalid hook call: more than one copy of React" 로 렌더 실패 발견 — 정적 게이트가 못 잡는 갭. 근인=pnpm workspace 에서 React 인스턴스 중복 해석. 수정=.storybook/main.ts viteFinal 에 resolve.dedupe:["react","react-dom"]. 재기동 후 Avatar/Input(이미지 onError fallback 포함) 콘솔 0에러 렌더 실증, build-storybook/eslint/tsc 재통과. Button 등 hook 없는 primitive 는 fix 전에도 정상이었음(디자인 시스템 배선 자체는 OK).
