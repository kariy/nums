import { initGrpcClient } from "./client";

export interface LeaderboardReferralRow {
  username: string;
  address: string;
  players: number;
  earned: number;
}

const MODEL_ID =
  "0x01c26a4ee3ef91d19e768afcacae51ea5240b2e9a7f861249dcc19af6cc038f2:0x027fb20c50c1bc8220c8d7643d495f921c67c7c69ffe3cb6b5d5a81dd1564fd7";

async function fetch(
  bundleIds: number[],
  protocolFee: number,
  referralFee: number,
): Promise<LeaderboardReferralRow[]> {
  const client = initGrpcClient();

  if (bundleIds.length === 0) {
    return [];
  }

  const query = `SELECT
    c.username AS username,
    data->>'$.referrer.Some' AS address,
    COUNT(DISTINCT data->>'$.recipient') AS players,
    SUM(('0x' || LTRIM(SUBSTR(data->>'$.amount', 3), '0') ->> '$')) AS amount
FROM event_messages_historical
JOIN controllers AS c ON c.address = data->>'$.referrer.Some'
WHERE model_id = '${MODEL_ID}'
AND data->>'$.referrer.Some' IS NOT NULL
AND data->>'$.bundle_id' IN (${bundleIds.join(",")})
GROUP BY c.username
ORDER BY amount DESC
LIMIT 1000;`;

  const rows = await client.executeSql(query);

  return rows.map((row) => ({
    username: String(row.username || ""),
    address: String(row.address || ""),
    players: Number(row.players) || 0,
    earned:
      (Number(row.amount) / 10 ** 6) * (1 - protocolFee) * referralFee || 0,
  }));
}

export const LeaderboardReferral = {
  keys: (ids: number[]) => ["leaderboard-referrals", ids] as const,
  fetch,
};
