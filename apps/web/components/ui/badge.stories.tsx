import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  args: {
    children: "방장",
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { tone: "primary" },
};

export const Muted: Story = {
  args: { tone: "muted", children: "멤버" },
};

export const Destructive: Story = {
  args: { tone: "destructive", children: "차단됨" },
};

export const Gradient: Story = {
  args: { tone: "gradient" },
};
