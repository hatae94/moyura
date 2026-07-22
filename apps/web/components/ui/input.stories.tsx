import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "./input";

const meta = {
  title: "UI/Input",
  component: Input,
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { placeholder: "example@email.com" },
};

export const WithLabel: Story = {
  args: { label: "이메일", placeholder: "example@email.com" },
};

export const WithError: Story = {
  args: {
    label: "이메일",
    placeholder: "example@email.com",
    error: "올바른 이메일 형식이 아닙니다.",
  },
};

export const Disabled: Story = {
  args: { label: "이메일", defaultValue: "example@email.com", disabled: true },
};
