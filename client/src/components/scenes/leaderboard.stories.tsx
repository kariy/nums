import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeaderboardScene } from "./leaderboard";
import { fn } from "storybook/test";
import type { LeaderboardScoreRowData } from "@/hooks/leaderboard";
import type { LeaderboardReferralRowData } from "@/hooks/leaderboard-referral";

const meta = {
  title: "Scenes/Leaderboard",
  component: LeaderboardScene,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen w-full p-4 md:p-6">
        <Story />
      </div>
    ),
  ],
  globals: {
    backgrounds: {
      value: "purple",
    },
  },
} satisfies Meta<typeof LeaderboardScene>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleRows: LeaderboardScoreRowData[] = [
  {
    username: "clicksave",
    player:
      "0x008b95a26e1392ed9e817607bfae2dd93efb9c66ee7db0b018091a11d9037006",
    games_played: 25,
    total_reward: 12500,
  },
  {
    username: "bal7hazar",
    player:
      "0x1234567890123456789012345678901234567890123456789012345678901234",
    games_played: 312,
    total_reward: 9800,
  },
  {
    username: "ashe",
    player:
      "0x2345678901234567890123456789012345678901234567890123456789012345",
    games_played: 12,
    total_reward: 7200,
  },
  {
    username: "glihm",
    player:
      "0x3456789012345678901234567890123456789012345678901234567890123456",
    games_played: 8,
    total_reward: 4100,
  },
  {
    username: "flippertherichdolphin",
    player:
      "0x4567890123456789012345678901234567890123456789012345678901234567",
    games_played: 10,
    total_reward: 3800,
  },
  {
    username: "steebchen",
    player:
      "0x5678901234567890123456789012345678901234567890123456789012345678",
    games_played: 124,
    total_reward: 6500,
  },
  {
    username: "nasr",
    player:
      "0x6789012345678901234567890123456789012345678901234567890123456789",
    games_played: 51,
    total_reward: 5200,
  },
  {
    username: "neo",
    player:
      "0x7890123456789012345678901234567890123456789012345678901234567890",
    games_played: 13,
    total_reward: 3100,
  },
  {
    username: "broody",
    player:
      "0x8901234567890123456789012345678901234567890123456789012345678901",
    games_played: 12,
    total_reward: 2900,
  },
  {
    username: "tarrence",
    player:
      "0x9012345678901234567890123456789012345678901234567890123456789012",
    games_played: 123,
    total_reward: 4800,
  },
  {
    username: "mickey",
    player:
      "0xa012345678901234567890123456789012345678901234567890123456789012",
    games_played: 321,
    total_reward: 9200,
  },
  {
    username: "donald",
    player:
      "0xb012345678901234567890123456789012345678901234567890123456789012",
    games_played: 123,
    total_reward: 4500,
  },
  {
    username: "goofy",
    player:
      "0xc012345678901234567890123456789012345678901234567890123456789012",
    games_played: 123,
    total_reward: 4400,
  },
  {
    username: "minnie",
    player:
      "0xd012345678901234567890123456789012345678901234567890123456789012",
    games_played: 123,
    total_reward: 4300,
  },
];

const sampleReferralRows: LeaderboardReferralRowData[] = [
  {
    username: "clicksave",
    address:
      "0x008b95a26e1392ed9e817607bfae2dd93efb9c66ee7db0b018091a11d9037006",
    players: 125,
    earned: 312.58,
  },
  {
    username: "bal7hazar",
    address:
      "0x1234567890123456789012345678901234567890123456789012345678901234",
    players: 98,
    earned: 245.32,
  },
  {
    username: "ashe",
    address:
      "0x2345678901234567890123456789012345678901234567890123456789012345",
    players: 72,
    earned: 181.05,
  },
  {
    username: "glihm",
    address:
      "0x3456789012345678901234567890123456789012345678901234567890123456",
    players: 54,
    earned: 145.9,
  },
  {
    username: "flippertherichdolphin",
    address:
      "0x4567890123456789012345678901234567890123456789012345678901234567",
    players: 48,
    earned: 124.37,
  },
  {
    username: "steebchen",
    address:
      "0x5678901234567890123456789012345678901234567890123456789012345678",
    players: 41,
    earned: 98.22,
  },
  {
    username: "nasr",
    address:
      "0x6789012345678901234567890123456789012345678901234567890123456789",
    players: 33,
    earned: 82.18,
  },
  {
    username: "neo",
    address:
      "0x7890123456789012345678901234567890123456789012345678901234567890",
    players: 27,
    earned: 68.7,
  },
  {
    username: "broody",
    address:
      "0x8901234567890123456789012345678901234567890123456789012345678901",
    players: 22,
    earned: 55.11,
  },
  {
    username: "tarrence",
    address:
      "0x9012345678901234567890123456789012345678901234567890123456789012",
    players: 18,
    earned: 45.26,
  },
];

export const Default: Story = {
  args: {
    rows: sampleRows,
    referralRows: sampleReferralRows,
    onClose: fn(),
  },
};

export const WithCurrentUser: Story = {
  args: {
    rows: sampleRows,
    referralRows: sampleReferralRows,
    currentUserAddress:
      "0x008b95a26e1392ed9e817607bfae2dd93efb9c66ee7db0b018091a11d9037006",
    onClose: fn(),
  },
};

export const Empty: Story = {
  args: {
    rows: [],
    referralRows: [],
    onClose: fn(),
  },
};
