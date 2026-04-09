import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaderboardReferralRow } from "./leaderboard-referral-row";

const meta = {
  title: "Elements/Leaderboard Referral Row",
  component: LeaderboardReferralRow,
  parameters: {
    layout: "padded",
  },
  globals: {
    backgrounds: {
      value: "dark",
    },
  },
} satisfies Meta<typeof LeaderboardReferralRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    rank: 1,
    username: "Player123",
    players: 42,
    earned: 125.5,
  },
};

export const Primary: Story = {
  args: {
    rank: 5,
    username: "MyUsername",
    players: 28,
    earned: 82.12,
    variant: "primary",
  },
};

export const LongUsername: Story = {
  args: {
    rank: 10,
    username: "VeryLongUsernameThatShouldBeTruncated",
    players: 15,
    earned: 54.33,
  },
};
