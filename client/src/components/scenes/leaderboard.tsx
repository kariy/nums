import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { ShadowEffect } from "@/components/icons";
import { LeaderboardScore } from "@/components/containers/leaderboard-score";
import { LeaderboardReferral } from "@/components/containers/leaderboard-referral";
import type { LeaderboardScoreRowData } from "@/hooks/leaderboard";
import type { LeaderboardReferralRowData } from "@/hooks/leaderboard-referral";
import {
  LeaderboardTabs,
  type LeaderboardTabType,
} from "@/components/elements/leaderboard-tabs";
import { Close } from "@/components/elements";
import type { LeaderboardRowProps } from "../elements";
import type { LeaderboardReferralRowProps } from "@/components/elements/leaderboard-referral-row";
import { useId, useMemo, useState } from "react";

export interface LeaderboardSceneProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof leaderboardSceneVariants> {
  rows: LeaderboardScoreRowData[];
  referralRows: LeaderboardReferralRowData[];
  currentUserAddress?: string;
  onClose?: () => void;
}

const leaderboardSceneVariants = cva(
  "select-none flex items-center justify-center gap-6 md:gap-10 p-2 xs:p-6 md:py-[120px] overflow-hidden w-full",
  {
    variants: {
      variant: {
        default:
          "rounded-2xl md:rounded-3xl bg-black-200 backdrop-blur-[8px] border-[2px] border-black-300 shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const LeaderboardScene = ({
  rows,
  referralRows,
  currentUserAddress,
  onClose,
  variant,
  className,
  ...props
}: LeaderboardSceneProps) => {
  const filterId = useId();
  const [tab, setTab] = useState<LeaderboardTabType>("Nums");

  const transformedRows = useMemo(() => {
    const transformed = rows.map((row) => {
      const isCurrentUser =
        BigInt(row.player) === BigInt(currentUserAddress ?? "0x0");

      return {
        username: row.username,
        total: row.games_played,
        totalReward: row.total_reward,
        variant: (isCurrentUser ? "primary" : "default") as
          | "primary"
          | "default",
      };
    });

    const sorted = transformed.sort((a, b) => b.totalReward - a.totalReward);

    return sorted.map((row, index) => ({
      ...row,
      rank: index + 1,
    })) satisfies LeaderboardRowProps[];
  }, [rows, currentUserAddress]);

  const transformedReferralRows = useMemo(() => {
    const transformed = referralRows.map((row) => {
      const isCurrentUser =
        !!row.address &&
        !!currentUserAddress &&
        BigInt(row.address) === BigInt(currentUserAddress);

      return {
        username: row.username,
        players: row.players,
        earned: row.earned,
        variant: (isCurrentUser ? "primary" : "default") as
          | "primary"
          | "default",
      };
    });

    const sorted = transformed.sort((a, b) => b.earned - a.earned);

    return sorted.map((row, index) => ({
      ...row,
      rank: index + 1,
    })) satisfies LeaderboardReferralRowProps[];
  }, [referralRows, currentUserAddress]);

  const renderLeaderboard = () =>
    tab === "Nums" ? (
      <LeaderboardScore
        rows={transformedRows}
        currentUserAddress={currentUserAddress}
      />
    ) : (
      <LeaderboardReferral
        rows={transformedReferralRows}
        currentUserAddress={currentUserAddress}
      />
    );

  return (
    <div
      className={cn(leaderboardSceneVariants({ variant, className }))}
      {...props}
    >
      <ShadowEffect filterId={filterId} />

      {/* Mobile */}
      <div
        className="flex flex-col md:hidden gap-6 w-full h-full overflow-y-auto pb-2"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Mobile header with close button */}
        <div className="flex items-center justify-between w-full">
          <Title />
          {onClose && (
            <div className="flex justify-end flex-shrink-0">
              <Close size="md" onClick={onClose} />
            </div>
          )}
        </div>
        <LeaderboardTabs
          value={tab}
          onValueChange={setTab}
          className="w-full"
        />
        {renderLeaderboard()}
      </div>

      {/* Desktop */}
      <div className="hidden md:flex md:flex-col md:items-stretch overflow-hidden h-full w-full">
        {/* Close button */}
        {onClose && (
          <Close
            size="lg"
            onClick={onClose}
            className="absolute z-10 top-8 right-8"
          />
        )}
        <div className="h-full w-full max-w-[720px] self-center overflow-hidden flex flex-col gap-6 md:gap-8">
          <div className="flex items-center justify-between">
            <Title />
            <LeaderboardTabs value={tab} onValueChange={setTab} />
          </div>
          {renderLeaderboard()}
        </div>
      </div>
    </div>
  );
};

const Title = () => {
  return (
    <h2
      className="text-[36px]/6 md:text-[64px]/[44px] text-white-100 uppercase tracking-wider translate-y-0.5"
      style={{ textShadow: "2px 2px 0px rgba(0, 0, 0, 0.25)" }}
    >
      Leaderboard
    </h2>
  );
};
