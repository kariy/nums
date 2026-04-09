import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaderboardReferral } from "./leaderboard-referral";

const meta = {
  title: "Containers/Leaderboard Referral",
  component: LeaderboardReferral,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="flex h-full w-full">
        <Story />
      </div>
    ),
  ],
  globals: {
    backgrounds: {
      value: "dark",
    },
  },
} satisfies Meta<typeof LeaderboardReferral>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleRows = [
  {
    rank: 1,
    username: "clicksave",
    players: 125,
    earned: 312.58,
    variant: "primary" as const,
  },
  {
    rank: 2,
    username: "bal7hazar",
    players: 98,
    earned: 245.32,
  },
  {
    rank: 3,
    username: "ashe",
    players: 72,
    earned: 181.05,
  },
  {
    rank: 4,
    username: "glihm",
    players: 54,
    earned: 145.9,
  },
  {
    rank: 5,
    username: "flippertherichdolphin",
    players: 48,
    earned: 124.37,
  },
  {
    rank: 6,
    username: "steebchen",
    players: 41,
    earned: 98.22,
  },
  {
    rank: 7,
    username: "nasr",
    players: 33,
    earned: 82.18,
  },
  {
    rank: 8,
    username: "neo",
    players: 27,
    earned: 68.7,
  },
  {
    rank: 9,
    username: "broody",
    players: 22,
    earned: 55.11,
  },
  {
    rank: 10,
    username: "tarrence",
    players: 18,
    earned: 45.26,
  },
  {
    rank: 11,
    username: "mickey",
    players: 14,
    earned: 36.8,
  },
  {
    rank: 12,
    username: "donald",
    players: 11,
    earned: 27.43,
  },
  {
    rank: 13,
    username: "goofy",
    players: 8,
    earned: 19.52,
  },
  {
    rank: 14,
    username: "minnie",
    players: 5,
    earned: 12.1,
  },
];

export const Default: Story = {
  args: {
    rows: sampleRows,
  },
};

export const Empty: Story = {
  args: {
    rows: [],
  },
};

export const SingleRow: Story = {
  args: {
    rows: [sampleRows[0]],
  },
};
