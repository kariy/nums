import { Packer } from "@/helpers/packer";
import { Power } from "@/types/power";
import { MULTIPLIER_PRECISION, DEFAULT_POWER_COUNT } from "@/constants";
import type { GameSnapshot } from "../types";

const TORII_SQL_URL = "https://api.cartridge.gg/x/nums-main/torii/sql";
const SLOT_SIZE = 12n;

interface ToriiRow {
  id: string;
  level: number;
  slot_min: number;
  slot_max: number;
  slot_count: number;
  slots: string;
  traps: string;
  disabled_traps: number;
  selectable_powers: number;
  selected_powers: number;
  enabled_powers: number;
  multiplier: string;
  reward: string;
  number: number;
  next_number: number;
  over: string;
  claimed: string;
}

function toHexKey(gameId: number): string {
  return "0x" + gameId.toString(16).padStart(64, "0") + "/";
}

function rowToSnapshot(row: ToriiRow): GameSnapshot {
  const slotCount = row.slot_count || 18;

  const slots = Packer.sized_unpack(BigInt(row.slots), SLOT_SIZE, slotCount);

  const traps = Packer.sized_unpack(BigInt(row.traps), 4n, slotCount).map(
    (i) => i,
  );

  const disabledTraps = Packer.sized_unpack(
    BigInt(row.disabled_traps),
    1n,
    slotCount,
  ).map((v) => v === 1);

  const selectablePowers = Power.getPowers(BigInt(row.selectable_powers)).map(
    (p) => p.into(),
  );

  const selectedPowers = Power.getPowers(BigInt(row.selected_powers)).map((p) =>
    p.into(),
  );

  const enabledPowers = Packer.sized_unpack(
    BigInt(row.enabled_powers),
    1n,
    DEFAULT_POWER_COUNT,
  ).map((v) => v === 1);

  const multiplier =
    Number(BigInt(row.multiplier)) / Number(MULTIPLIER_PRECISION);

  const reward = Number(BigInt(row.reward) / 10n ** 18n);

  return {
    id: Number(row.id),
    number: row.number,
    next_number: row.next_number,
    level: row.level,
    reward,
    multiplier,
    slots,
    traps,
    disabled_traps: disabledTraps,
    selected_powers: selectedPowers,
    enabled_powers: enabledPowers,
    selectable_powers: selectablePowers,
    over: Number(row.over || 0),
  };
}

export async function fetchGameReplay(gameId: number): Promise<GameSnapshot[]> {
  const hexKey = toHexKey(gameId);

  const sql = `
SELECT
    json_extract(data, '$.id') AS id,
    CAST(json_extract(data, '$.level') AS INTEGER) AS level,
    CAST(json_extract(data, '$.slot_min') AS INTEGER) AS slot_min,
    CAST(json_extract(data, '$.slot_max') AS INTEGER) AS slot_max,
    CAST(json_extract(data, '$.slot_count') AS INTEGER) AS slot_count,
    json_extract(data, '$.slots') AS slots,
    json_extract(data, '$.traps') AS traps,
    json_extract(data, '$.disabled_traps') AS disabled_traps,
    json_extract(data, '$.selectable_powers') AS selectable_powers,
    json_extract(data, '$.selected_powers') AS selected_powers,
    json_extract(data, '$.enabled_powers') AS enabled_powers,
    json_extract(data, '$.multiplier') AS multiplier,
    json_extract(data, '$.reward') AS reward,
    CAST(json_extract(data, '$.number') AS INTEGER) AS number,
    CAST(json_extract(data, '$.next_number') AS INTEGER) AS next_number,
    json_extract(data, '$.over') AS over,
    json_extract(data, '$.claimed') AS claimed
FROM entities_historical
WHERE keys = '${hexKey}'
ORDER BY executed_at ASC;
  `.trim();

  const response = await fetch(TORII_SQL_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: sql,
  });

  if (!response.ok) {
    throw new Error(
      `Torii SQL error: ${response.status} ${response.statusText}`,
    );
  }

  const rows: ToriiRow[] = await response.json();

  if (rows.length === 0) {
    throw new Error(`No game data found for game ID ${gameId}`);
  }

  return rows.map(rowToSnapshot);
}
