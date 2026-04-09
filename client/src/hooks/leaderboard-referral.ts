import { queryKeys } from "@/api/keys";
import {
  LeaderboardReferral as LeaderboardReferralApi,
  type LeaderboardReferralRow,
} from "@/api/torii/leaderboard-referral";
import { useQuery } from "@tanstack/react-query";
import { PROTOCOL_FEE, REFERRAL_FEE } from "@/constants";
import { useBundles } from "@/context/bundles";

export type LeaderboardReferralRowData = LeaderboardReferralRow;

export const useLeaderboardReferral = (): {
  data: LeaderboardReferralRowData[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} => {
  const { bundles } = useBundles();
  const bundleIds = bundles.map((bundle) => bundle.id);

  const query = useQuery<LeaderboardReferralRowData[]>({
    queryKey: queryKeys.leaderboardReferrals(bundleIds),
    queryFn: () =>
      LeaderboardReferralApi.fetch(bundleIds, PROTOCOL_FEE, REFERRAL_FEE),
    enabled: bundleIds.length > 0,
    staleTime: 0,
    gcTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
};
