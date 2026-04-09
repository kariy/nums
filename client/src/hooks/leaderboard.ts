import { queryKeys } from "@/api/keys";
import {
  LeaderboardScore,
  type LeaderboardScoreRow,
} from "@/api/torii/leaderboard-score";
import { useQuery } from "@tanstack/react-query";

export type LeaderboardScoreRowData = LeaderboardScoreRow;

export const useLeaderboard = (): {
  data: LeaderboardScoreRowData[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} => {
  const query = useQuery<LeaderboardScoreRowData[]>({
    queryKey: queryKeys.leaderboardScore(),
    queryFn: LeaderboardScore.fetch,
    enabled: false,
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
