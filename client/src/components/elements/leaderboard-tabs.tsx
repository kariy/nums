import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { ReferralIcon, TrophyIcon } from "@/components/icons";
import { useId } from "react";

export type LeaderboardTabType = "Nums" | "Referrals";

export interface LeaderboardTabsProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof leaderboardTabsVariants> {
  value: LeaderboardTabType;
  onValueChange: (value: LeaderboardTabType) => void;
}

const leaderboardTabsVariants = cva(
  "flex items-center justify-center gap-0.5 h-10",
  {
    variants: {
      variant: {
        default: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const leaderboardTabVariants = cva(
  "h-10 flex-1 flex items-center justify-center gap-0.5 py-2 px-3 min-w-auto text-white-400 hover:text-white-300 data-[active=true]:text-white-100 bg-primary-800 hover:bg-primary-700 data-[active=true]:bg-primary-500 data-[active=true]:hover:bg-primary-500 data-[active=true]:hover:cursor-default data-[active=true]:shadow-[1px_1px_0px_0px_rgba(255,255,255,0.12)_inset,1px_1px_0px_0px_rgba(0,0,0,0.12)]",
);

export const LeaderboardTabs = ({
  value,
  onValueChange,
  variant,
  className,
  ...props
}: LeaderboardTabsProps) => {
  const filterId = useId();
  const isNumsActive = value === "Nums";
  const isReferralsActive = value === "Referrals";

  return (
    <div
      className={cn(leaderboardTabsVariants({ variant }), className)}
      {...props}
    >
      {/* Filters */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="2"
              dy="2"
              stdDeviation="0"
              floodColor="rgba(0, 0, 0, 1)"
            />
          </filter>
        </defs>
      </svg>
      <Button
        variant="ghost"
        type="button"
        data-active={isNumsActive}
        aria-label="Nums Leaderboard"
        aria-pressed={isNumsActive}
        className={cn(leaderboardTabVariants(), "rounded-l-lg rounded-r-none")}
        onClick={() => {
          if (!isNumsActive) onValueChange("Nums");
        }}
      >
        <TrophyIcon
          size="md"
          variant="solid"
          className="min-w-6 min-h-6"
          style={{ filter: isNumsActive ? `url(#${filterId})` : undefined }}
        />
        <span
          className="text-[22px]/[15px] tracking-wider translate-y-0.5 px-1"
          style={{
            textShadow: isNumsActive
              ? "2px 2px 0px rgba(0, 0, 0, 1)"
              : undefined,
          }}
        >
          Nums
        </span>
      </Button>
      <Button
        variant="ghost"
        type="button"
        data-active={isReferralsActive}
        aria-label="Referrals Leaderboard"
        aria-pressed={isReferralsActive}
        className={cn(leaderboardTabVariants(), "rounded-r-lg rounded-l-none")}
        onClick={() => {
          if (!isReferralsActive) onValueChange("Referrals");
        }}
      >
        <ReferralIcon
          size="md"
          className="min-w-6 min-h-6"
          style={{
            filter: isReferralsActive ? `url(#${filterId})` : undefined,
          }}
        />
        <span
          className="text-[22px]/[15px] tracking-wider translate-y-0.5 px-1"
          style={{
            textShadow: isReferralsActive
              ? "2px 2px 0px rgba(0, 0, 0, 1)"
              : undefined,
          }}
        >
          Referrals
        </span>
      </Button>
    </div>
  );
};
