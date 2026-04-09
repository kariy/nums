import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import {
  LeaderboardReferralRow,
  type LeaderboardReferralRowProps,
} from "@/components/elements/leaderboard-referral-row";

export interface LeaderboardReferralProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof leaderboardReferralVariants> {
  rows: LeaderboardReferralRowProps[];
  currentUserAddress?: string;
}

const leaderboardReferralVariants = cva(
  "select-none overflow-hidden h-full w-full flex flex-col gap-6",
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

export const LeaderboardReferral = ({
  rows,
  currentUserAddress,
  variant,
  className,
  ...props
}: LeaderboardReferralProps) => {
  return (
    <div
      className={cn(leaderboardReferralVariants({ variant, className }))}
      {...props}
    >
      {/* Headers */}
      <div className="flex items-center gap-4 h-3 px-4">
        <div className="flex-1 text-left">
          <span
            className="font-primary text-lg/3 tracking-wider align-middle text-white-400 translate-y-0.5"
            style={{
              textShadow: "2px 2px 0px rgba(0, 0, 0, 0.25)",
            }}
          >
            <span className="hidden md:inline">Rank</span>
            <span className="inline md:hidden">#</span>
          </span>
        </div>
        <div className="flex-[3] min-w-0 text-left">
          <span
            className="font-primary text-lg/3 tracking-wider align-middle text-white-400 translate-y-0.5"
            style={{
              textShadow: "2px 2px 0px rgba(0, 0, 0, 0.25)",
            }}
          >
            Referrer
          </span>
        </div>
        <div className="flex-[2] text-left">
          <span
            className="font-primary text-lg/3 tracking-wider align-middle text-white-400 translate-y-0.5"
            style={{
              textShadow: "2px 2px 0px rgba(0, 0, 0, 0.25)",
            }}
          >
            Players
          </span>
        </div>
        <div className="flex-[2] text-left">
          <span
            className="font-primary text-lg/3 tracking-wider align-middle text-white-400 translate-y-0.5"
            style={{
              textShadow: "2px 2px 0px rgba(0, 0, 0, 0.25)",
            }}
          >
            Earned
          </span>
        </div>
      </div>

      {/* Rows or Empty state */}
      {rows.length === 0 ? (
        <div className="bg-black-900 border border-white-800 rounded-lg py-12 flex items-center justify-center h-full">
          <p
            className="text-primary-100 text-lg/6 tracking-wider translate-y-0.5 w-1/2 text-center"
            style={{
              textShadow: "2px 2px 0px rgba(0, 0, 0, 0.25)",
            }}
          >
            No referrals have been made yet
          </p>
        </div>
      ) : (
        <div
          className="flex flex-col gap-2 overflow-y-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {rows.map((row, index) => (
            <LeaderboardReferralRow key={index} {...row} />
          ))}
        </div>
      )}
    </div>
  );
};
