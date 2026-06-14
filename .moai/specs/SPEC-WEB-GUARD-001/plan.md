# SPEC-WEB-GUARD-001 — 구현 계획 (Plan)

## 1. 기술 접근 (Technical Approach)

단일 파일 추가로 기존 가드의 커버리지를 확장한다. 새 로직·새 정책 없음.

- `apps/web/app/moims/layout.tsx`를 신규 작성한다.
  - 서버 컴포넌트(`async` 함수, `"use client"` 없음).
  - `@/lib/auth/require-named-session`의 `requireNamedSession`을 import.
  - 본문에서 `await requireNamedSession()` 호출 후 `children`을 그대로 반환.
  - (main) 레이아웃의 `BottomTabBar`·셸 감지 스크립트·announcer는 **포함하지 않는다**(chat은 풀스크린).
- 기존 파일은 일절 수정하지 않는다.

참고 형태(설계 의도):

```tsx
import { requireNamedSession } from "@/lib/auth/require-named-session";

export default async function MoimsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireNamedSession(); // 세션 없음 → /login, 이름 없음 → /onboarding (내부 redirect)
  return <>{children}</>;
}
```

## 2. 마일스톤 (Milestones — 우선순위 기반)

- **M1 (Priority High)**: `app/moims/layout.tsx` 신규 작성 (가드 + children 렌더링).
- **M2 (Priority High)**: 검증 게이트 실행 — `nx run web:build`, web lint, `tsc` 0 error 확인.

## 3. 리스크 (Risks)

| 리스크 | 심각도 | 대응 |
|--------|--------|------|
| moims 레이아웃에 (main) 셸 요소를 잘못 복제 | LOW | 설계상 가드+children만. AC-4가 시각 회귀(탭바 추가 금지)를 검증. |
| 리다이렉트 루프 | LOW | `/login`·`/onboarding`이 `app/moims/` 밖이라 구조적으로 불가능. |
| Next.js 버전별 레이아웃 규약 차이 | LOW | `apps/web/AGENTS.md` 지침대로 작성 전 `node_modules/next/dist/docs/` 관련 가이드 확인. |

## 4. 의존 (Dependencies)

- 선행: `apps/web/lib/auth/require-named-session.ts` 존재(이미 SPEC-MOBILE-004에서 구현·검증됨).
- 후행: 없음.
