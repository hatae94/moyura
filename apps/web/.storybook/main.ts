import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { StorybookConfig } from "@storybook/react-vite";

// @MX:NOTE [AUTO] 빌더 = @storybook/react-vite (SD-2 확정) — 5 primitive 가 next/image·next/link·
// next/font·next/router 를 전혀 의존하지 않아(CP-1 재확인 완료) Next 16 프레임워크 지원 랙과
// 디커플링된 경량 react-vite 를 그대로 쓴다. next/* 요구가 생기면 @storybook/nextjs-vite 로 전환.
const config: StorybookConfig = {
  stories: ["../components/ui/**/*.stories.@(tsx)"],
  // 코어 only — a11y/interaction test-runner/시각회귀/새 테스트 프레임워크 애드온 없음(HARD, Non-Goals).
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (viteConfig) => {
    // @storybook/builder-vite 는 React 플러그인을 자동 주입하지 않으므로 명시 배선한다.
    viteConfig.plugins = [...(viteConfig.plugins ?? []), react()];

    // apps/web/tsconfig.json 의 `@/*` -> `./*` 경로 별칭을 Storybook Vite 빌드에도 배선한다
    // (Storybook Vite 는 tsconfig paths 를 자동 해석하지 않음 — CP-3).
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        ...viteConfig.resolve?.alias,
        "@": fileURLToPath(new URL("..", import.meta.url)),
      },
    };

    return viteConfig;
  },
};

export default config;
