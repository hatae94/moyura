---
name: tailwind-v4-css-fallback-minify
description: apps/web Tailwind v4 + Next 16 build strips duplicate-declaration CSS fallbacks via Lightning CSS; use @supports for unit fallbacks
metadata:
  type: project
---

In `apps/web` (Tailwind v4 `@import "tailwindcss"` + Next 16 Turbopack), the production build minifier (Lightning CSS) **deduplicates consecutive same-property declarations**, so the classic progressive-enhancement fallback pattern `height: 100vh; height: 100svh;` gets collapsed to only `height:100svh` in the built CSS — the `vh` fallback silently disappears.

**Why:** Lightning CSS treats the later declaration as a full override and drops the earlier one, not recognizing that the newer unit (`svh`/`dvh`/`lvh`) may be unsupported by an older browser target. This defeats any same-property CSS fallback written for old-browser support.

**How to apply:** When you need a CSS unit (or any feature) fallback that must survive the build, write the **old value as the base** and override it inside an `@supports` block — Lightning CSS preserves `@supports`:
```css
@utility h-svh-fixed {
  height: 100vh;                      /* base — kept */
  @supports (height: 100svh) {
    height: 100svh;                   /* override — kept, guarded */
  }
}
```
Verify after building by grepping the emitted CSS under `apps/web/.next/static/**/*.css` (exclude `*dev*`) for BOTH units. Do NOT trust the source-CSS fallback to reach production. Relates to [[web-no-test-harness]] — visual/build verification only, no test harness.
