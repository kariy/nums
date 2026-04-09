import { cn } from "@/lib/utils";
import { formatCompactNumber } from "@/helpers/number";
import { cva, type VariantProps } from "class-variance-authority";

export interface LeaderboardReferralRowProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof leaderboardReferralRowVariants> {
  rank: number;
  username: string;
  players: number;
  earned: number;
}

const leaderboardReferralRowVariants = cva(
  "flex items-center gap-3 md:gap-4 h-11 rounded-lg py-3 px-4",
  {
    variants: {
      variant: {
        default:
          "bg-white-900 shadow-[1px_1px_0px_0px_rgba(255,255,255,0.04)_inset,1px_1px_0px_0px_rgba(0,0,0,0.12)]",
        primary:
          "bg-green-800 shadow-[1px_1px_0px_0px_rgba(255,255,255,0.04)_inset,1px_1px_0px_0px_rgba(0,0,0,0.12)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const LeaderboardReferralRow = ({
  rank,
  username,
  players,
  earned,
  variant,
  className,
  ...props
}: LeaderboardReferralRowProps) => {
  return (
    <div
      className={cn(leaderboardReferralRowVariants({ variant, className }))}
      {...props}
    >
      {/* Rank */}
      <div className="flex-1 text-left">
        <span
          className={cn(
            "text-base/5 tracking-normal align-middle font-sans",
            variant === "primary" ? "text-green-100" : "text-white-100",
          )}
          style={{ fontWeight: 450 }}
        >
          {rank}
        </span>
      </div>

      {/* Referrer */}
      <div className="flex-[3] min-w-0 text-left">
        <span
          className={cn(
            "text-base/5 tracking-normal align-middle font-sans truncate block",
            variant === "primary" ? "text-green-100" : "text-white-100",
          )}
        >
          {username}
        </span>
      </div>

      {/* Players */}
      <div className="flex-[2] text-left">
        <span
          className={cn(
            "text-base/5 tracking-normal align-middle font-sans",
            variant === "primary" ? "text-green-100" : "text-white-100",
          )}
        >
          {players}
        </span>
      </div>

      {/* Earned */}
      <div className="flex-[2] text-left">
        <span
          className={cn(
            "text-base/5 tracking-normal align-middle font-sans",
            variant === "primary" ? "text-green-100" : "text-white-100",
          )}
        >
          <span className="hidden md:inline">
            {`$${earned.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`}
          </span>
          <span className="inline md:hidden">
            {`$${formatCompactNumber(earned)}`}
          </span>
        </span>
      </div>
    </div>
  );
};
