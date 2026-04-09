import { initGrpcClient } from "./client";

export interface LeaderboardScoreRow {
  username: string;
  player: string;
  games_played: number;
  total_reward: number;
}

async function fetch(): Promise<LeaderboardScoreRow[]> {
  const client = initGrpcClient();
  const query = `SELECT 
    c.username,
    g.player_id AS player,
    COUNT(*) AS games_played,
    SUM(('0x' || LTRIM(SUBSTR(g.reward, 3), '0') ->> '$')) AS total_reward
FROM "NUMS-Claimed" AS g
JOIN controllers AS c ON c.address = g.player_id
GROUP BY g.player_id, c.username
ORDER BY total_reward DESC`;

  const rows = await client.executeSql(query);

  return rows.map((row) => ({
    username: String(row.username || ""),
    player: String(row.player || ""),
    games_played: Number(row.games_played) || 0,
    total_reward: Number(row.total_reward) || 0,
  }));
}

export const LeaderboardScore = {
  keys: () => ["leaderboard-score"] as const,
  fetch,
};
