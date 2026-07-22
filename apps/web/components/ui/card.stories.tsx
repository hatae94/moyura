import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "./card";

const meta = {
  title: "UI/Card",
  component: Card,
  args: {
    children: <p className="text-sm text-muted-foreground">카드 본문 콘텐츠입니다.</p>,
  },
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const WithHeader: Story = {
  args: {
    header: "모임 정보",
  },
};

export const WithHeaderAndFooter: Story = {
  args: {
    header: "모임 정보",
    footer: <span className="text-xs text-muted-foreground">마지막 업데이트: 방금 전</span>,
  },
};

export const DensityNone: Story = {
  args: { padding: "none", children: <p className="text-sm">padding 없음</p> },
};

export const DensityCompact: Story = {
  args: { padding: "sm" },
};

export const DensitySpacious: Story = {
  args: { padding: "lg" },
};
