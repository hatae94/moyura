import type { Preview } from "@storybook/react-vite";

// @MX:NOTE [AUTO] globals.css import 가 디자인 시스템의 단일 진입점이다.
// @MX:REASON 이 import 가 :root 시맨틱 토큰 + @theme 유틸 + @utility(gradient-brand 등)를 전부
// 스토리에 주입한다 — 제거하거나 다른 파일로 옮기면 모든 스토리가 스타일 없이(unstyled) 렌더된다.
import "../app/globals.css";

// globals.css 가 light 전용 디자인이라(다크 팔레트 없음) 다크 모드 토글은 두지 않는다.
const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
