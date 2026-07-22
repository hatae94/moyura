import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar } from "./avatar";

const meta = {
  title: "UI/Avatar",
  component: Avatar,
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const InitialFallback: Story = {
  args: { fallback: "태용" },
};

export const Small: Story = {
  args: { fallback: "태용", size: "sm" },
};

export const Medium: Story = {
  args: { fallback: "태용", size: "md" },
};

export const Large: Story = {
  args: { fallback: "태용", size: "lg" },
};

// 존재하지 않는 로컬 경로라 onError 가 발동해 이니셜 fallback 으로 자연 전환된다(순수 상태, 외부 네트워크 없음).
export const ImageFallsBackToInitial: Story = {
  args: { src: "/storybook-nonexistent-avatar.png", fallback: "태용" },
};

export const WithGradientRing: Story = {
  args: { fallback: "태용", gradientRing: true },
};
