---
name: torii-data
description: Fetching game state history from Torii SQL for replay videos. Bitmask unpacking, calculateMetadata pattern, data flow.
metadata:
  tags: torii, sql, fetch, game-state, calculateMetadata, packer, bitmask
---

## Data flow

```
calculateMetadata (runs before render)
  ↓
fetchGameReplay(gameId)
  ↓
POST https://api.cartridge.gg/x/nums-main/torii/sql
  ↓
rows: ToriiRow[]
  ↓
rowToSnapshot() — unpacks Power/Trap/Packer bitmasks
  ↓
snapshots: GameSnapshot[]
  ↓
Replay component renders each frame from snapshots[stateIndex]
```

## The SQL query

Targets the `entities_historical` table, filtering by the game's key (hex-encoded game ID padded to 66 chars). Returns rows ordered by `executed_at` for chronological replay.

```sql
SELECT
    json_extract(data, '$.id') AS id,
    CAST(json_extract(data, '$.level') AS INTEGER) AS level,
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
    json_extract(data, '$.over') AS over
FROM entities_historical
WHERE keys = '<hex_key>'
ORDER BY executed_at ASC;
```

**Important**: Torii stores Dojo model state as JSON. `claimed` is NOT a column — it's extracted via `json_extract(data, '$.claimed')`. Don't `WHERE claimed = 0` directly.

### Key format

```ts
function toHexKey(gameId: number): string {
  return "0x" + gameId.toString(16).padStart(64, "0") + "/";
}
// gameId 343 → "0x0000...00000157/"
```

The trailing `/` is part of Torii's multi-key format (empty second key).

## Unpacking the raw data

Dojo stores arrays and bitmasks as packed felt252 values. The client has helpers that MUST be reused (NOT reimplemented):

```ts
import { Packer } from "@/helpers/packer";
import { Power } from "@/types/power";
import { Trap } from "@/types/trap";
import { MULTIPLIER_PRECISION, DEFAULT_POWER_COUNT } from "@/constants";
```

### Slots (12 bits per slot)

```ts
const slots = Packer.sized_unpack(BigInt(row.slots), 12n, slotCount);
// Returns number[] — each entry is 0 (empty) or 1-999 (placed number)
```

### Traps (4 bits per slot, packed via Trap.getTraps bitmap)

```ts
const traps = Packer.sized_unpack(BigInt(row.traps), 4n, slotCount);
// Returns number[] — each entry is a Trap enum index
```

### Disabled traps (1 bit per slot, bitmask)

```ts
const disabledTraps = Packer.sized_unpack(
  BigInt(row.disabled_traps),
  1n,
  slotCount,
).map((v) => v === 1);
```

### Enabled powers (1 bit per power slot)

```ts
const enabledPowers = Packer.sized_unpack(
  BigInt(row.enabled_powers),
  1n,
  DEFAULT_POWER_COUNT,
).map((v) => v === 1);
```

### Selectable / selected powers (variable-width bitmap)

```ts
const selectablePowers = Power.getPowers(BigInt(row.selectable_powers)).map(
  (p) => p.into(),
);

const selectedPowers = Power.getPowers(BigInt(row.selected_powers)).map((p) =>
  p.into(),
);
```

**CRITICAL**: Use `p.into()` (enum index, 1 = Reroll) NOT `p.index()` (custom mapping, 0 = Reroll). `Power.from()` expects the enum index. Mixing them produces off-by-one errors where Reroll becomes None.

### Multiplier and reward (scaled integers)

```ts
const multiplier =
  Number(BigInt(row.multiplier)) / Number(MULTIPLIER_PRECISION); // /10^6
const reward = Number(BigInt(row.reward) / 10n ** 18n); // /10^18
```

## The calculateMetadata pattern

Remotion's `calculateMetadata` is the **only** place to do async data fetching. It runs once before rendering starts and can return transformed props + duration.

```ts
const calculateMetadata: CalculateMetadataFunction<ReplayProps> = async ({
  props,
}) => {
  const { gameId } = props;
  if (!gameId) throw new Error("gameId is required");

  const snapshots = await fetchGameReplay(gameId);

  return {
    props: { ...props, snapshots /* ... */ },
    durationInFrames:
      INTRO_FRAMES + snapshots.length * FRAMES_PER_STATE + OUTRO_FRAMES,
  };
};
```

**Key points:**

- `props` passed to `calculateMetadata` is **merged**: `inputProps` (from CLI `--props` or Studio props panel) merged over `defaultProps`
- The returned `props` REPLACES what the component receives. Always spread `...props` to keep unchanged fields.
- `durationInFrames` MUST account for intro + game states + outro
- Throwing in `calculateMetadata` surfaces as a clean error in the Studio and CLI — don't silently fallback to mocks in production

## The Replay component side

The `Replay` component receives `snapshots: GameSnapshot[]` and computes which state to show based on `useCurrentFrame()`:

```tsx
const frame = useCurrentFrame();
const gameFrame = Math.max(0, frame - introFrames);
const stateIndex = Math.min(
  Math.floor(gameFrame / framesPerState),
  snapshots.length - 1,
);
const snapshot = snapshots[stateIndex];
```

Each snapshot is converted to a full `Game` instance via `snapshotToGame()` so the client components (`GameScene`, `GameOver`) work unchanged.

## Testing with a real game

The highest game ID on mainnet at time of writing is ~432. Use `343` as a safe test ID:

```bash
pnpm remotion:render:game '{"gameId":343,"numsPrice":0.0115}'
```

If you try a non-existent gameId, `fetchGameReplay` throws `No game data found for game ID N`.
