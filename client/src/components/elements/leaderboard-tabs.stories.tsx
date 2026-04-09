import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaderboardTabs } from "./leaderboard-tabs";
import { useState } from "react";
import type { LeaderboardTabType } from "./leaderboard-tabs";
import { fn } from "storybook/test";
import { userEvent, within, expect } from "storybook/test";

const meta = {
  title: "Elements/Leaderboard Tabs",
  component: LeaderboardTabs,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story, context) => {
      const [value, setValue] = useState<LeaderboardTabType>(
        context.args.value || "Nums",
      );
      return (
        <Story
          args={{
            ...context.args,
            value,
            onValueChange: (newValue: LeaderboardTabType) => {
              setValue(newValue);
              context.args.onValueChange?.(newValue);
            },
          }}
        />
      );
    },
  ],
  globals: {
    backgrounds: {
      value: "dark",
    },
  },
} satisfies Meta<typeof LeaderboardTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "Nums",
    onValueChange: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const numsButton = canvas.getByRole("button", {
      name: /nums leaderboard/i,
    });

    await expect(numsButton).toHaveAttribute("data-active", "true");

    await userEvent.hover(numsButton);
  },
};

export const Referrals: Story = {
  args: {
    value: "Referrals",
    onValueChange: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const referralsButton = canvas.getByRole("button", {
      name: /referrals leaderboard/i,
    });
    const numsButton = canvas.getByRole("button", {
      name: /nums leaderboard/i,
    });

    await expect(referralsButton).toHaveAttribute("data-active", "true");

    await expect(numsButton).toHaveAttribute("data-active", "false");

    await userEvent.hover(numsButton);
  },
};
