---
name: render-daily-replay
description: Auto-render a Remotion video replay of a Nums game on Mainnet. Resolves the target `gameId` from Torii (best reward of the day OR best score of the day, OR a specific gameId the user provides), silently auto-fetches the current NUMS price from Ekubo, then runs `pnpm remotion:render:game` with the right props. Use when the user asks to render today's top game, the daily winner, the biggest reward, the highest score, or any specific gameId, without having to assemble the render command by hand.
metadata:
  tags: nums, remotion, replay, daily, torii, mainnet, ekubo, render, video, automation
---

## When to use

Load this skill when the user asks for things like:

- "Render the best reward of today"
- "Make a video of today's top scorer"
- "Render the daily winner"
- "Render game 1523"
- "Render today's highest score as a replay"
- Any request that maps to the shape `pnpm remotion:render:game '{"gameId":N,"numsPrice":P}'`

For how the Remotion package is wired internally (webpack, overrides, fonts, hosting), also load **`nums-remotion-replay`**. This skill is about **calling** the render command; that one is about **editing** the render code.

## Core principle

Every happy path through this skill ends with exactly one command:

```bash
pnpm remotion:render:game '{"gameId":<N>,"numsPrice":<P>}'
```

run from the repo root. Everything else in this skill is about resolving `<N>` and `<P>` with zero user guesswork.

- `<N>` comes from Torii (one of two stored SQL queries) or from the user directly.
- `<P>` is always fetched silently from Ekubo — the same source the client app uses. Never hardcode it, never ask the user.

## Endpoints (Mainnet only)

### Torii SQL — from `client/.env.production`

```
VITE_SN_MAIN_TORII_URL = "https://api.cartridge.gg/x/nums-mainnet/torii"
```

SQL endpoint = `${VITE_SN_MAIN_TORII_URL}/sql` →
`https://api.cartridge.gg/x/nums-mainnet/torii/sql`

Queries are sent as `GET` with `?query=...` or `POST` with the SQL in the body. The helper script uses `curl -G --data-urlencode` to handle escaping.

### Ekubo quoter — same API the client uses

```
https://prod-api-quoter.ekubo.org/{chainId}/{amount}/{tokenHex}/{quoteHex}
```

Mainnet constants (verified against `client/src/context/prices.tsx` and `client/src/config.ts`):

| Field               | Value                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `chainId` (SN_MAIN) | `23448594291968334` (decimal form of `shortString("SN_MAIN")`)                                                       |
| `amount`            | `100000000000000000000` (100 NUMS, 18 decimals)                                                                      |
| NUMS token          | `0x2e82800f97afded96e8e88f9788f2d8f097edb04c9e9b920ceb1ec11f265158` (from `manifest_mainnet.json` → `NUMS-Token`)    |
| Quote (USDC)        | `0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb` (from `.env.production` → `VITE_SN_MAIN_QUOTE`) |

Formula (mirrors `fetchTokenUsdPrice` in `client/src/context/prices.tsx`):

```
numsPrice = total_calculated / 1e6 / 100
```

- `total_calculated` = Ekubo response field, USDC amount (6 decimals) received for swapping 100 NUMS → USDC
- `/ 1e6` → undo USDC decimals
- `/ 100` → divide by the 100 NUMS input, giving USD per 1 NUMS

## The two stored SQL queries

### Query A — Best reward of today (most NUMS won)

```sql
SELECT
    c.username,
    g.game_id,
    g.player_id AS player,
    ('0x' || LTRIM(SUBSTR(g.reward, 3), '0') ->> '$') AS reward_decimal,
    g.internal_executed_at
FROM "NUMS-Claimed" AS g
JOIN controllers AS c ON c.address = g.player_id
WHERE DATE(g.internal_executed_at) = DATE('now')
ORDER BY reward_decimal DESC
LIMIT 1;
```

Returns a single row with:

- `game_id` — hex string, e.g. `0x00000000000005f3` (→ `1523`)
- `username` — controller username of the winner
- `player` — player address
- `reward_decimal` — reward already decoded to a decimal integer (NUMS, whole units)
- `internal_executed_at` — timestamp

### Query B — Best score of today (highest placed numbers)

```sql
SELECT
    g.game_id,
    g.score
FROM "NUMS-LeaderboardScore" AS g
WHERE DATE(g.internal_executed_at) = DATE('now')
ORDER BY score DESC
LIMIT 1;
```

Returns a single row with:

- `game_id` — hex string, padded to 64 hex chars (same underlying value, different padding from Query A)
- `score` — hex string (e.g. `0x0000000000000012` = `18`)

Both `game_id` outputs must be converted to a decimal integer before being passed to the render command.

## Workflow

### Step 0 — Parse the user's request

Look for these signals in the user's message:

| User says                                              | Mode          | Action                  |
| ------------------------------------------------------ | ------------- | ----------------------- |
| "best reward", "top reward", "biggest prize", "winner" | `best-reward` | Run Query A             |
| "best score", "top score", "highest score", "top 1"    | `best-score`  | Run Query B             |
| "game 1523", "gameId 1523", a bare number              | `game-id`     | Use the number directly |
| Ambiguous ("render today's game", "make a replay")     | ask once      | See Step 1              |

### Step 1 — Clarify only if ambiguous

If the user did not specify, ask **one** question:

> Which game should I render?
>
> 1. **Best reward** of today
> 2. **Best score** of today
> 3. A specific gameId (please provide the decimal number)

Do **not** ask about `numsPrice` — it is always auto-fetched.

### Step 2 — Resolve `gameId`

Run the helper script with the appropriate flag. It handles Torii, hex→decimal conversion, and empty-result handling in one place:

```bash
./.agents/skills/render-daily-replay/scripts/render-daily-replay.sh --best-reward
./.agents/skills/render-daily-replay/scripts/render-daily-replay.sh --best-score
./.agents/skills/render-daily-replay/scripts/render-daily-replay.sh --game-id 1523
```

The script:

1. Fetches the Torii row (for `--best-reward` / `--best-score`) and extracts `game_id`.
2. Converts hex → decimal.
3. Fetches `numsPrice` from Ekubo and computes `total_calculated / 1e6 / 100`.
4. Echoes a summary block (game id, username/score if applicable, numsPrice).
5. Invokes `pnpm remotion:render:game '{"gameId":N,"numsPrice":P}'`.
6. Verifies `remotion/out/game-replay.mp4` exists.

Flags:

- `--best-reward` — use Query A
- `--best-score` — use Query B
- `--game-id N` — use `N` directly (skip Torii fetch)
- `--dry-run` — print the final command and exit without rendering (use this during smoke-tests or when the user wants a preview)
- `--nums-price X` — override the auto-fetched price (escape hatch; do not offer proactively)

### Step 3 — Announce and execute

Before running the script, tell the user:

- Which mode you're using (best-reward / best-score / specific gameId)
- The resolved `gameId` (decimal)
- The auto-fetched `numsPrice`
- The fact that rendering takes 2–5 minutes

Then run the script (without `--dry-run`) and stream its output. The final `.mp4` lands at `remotion/out/game-replay.mp4`.

### Step 4 — Confirm output

After the script exits cleanly:

```bash
ls -lh remotion/out/game-replay.mp4
```

Report the absolute path and file size to the user.

## Non-obvious gotchas

1. **Torii URL lives in `client/.env.production`**, not at repo root. Key is `VITE_SN_MAIN_TORII_URL`, and SQL is served at `${URL}/sql`. Do not hardcode a different host; the value in `remotion/src/data/torii.ts` uses a legacy alias (`nums-main`) that happens to resolve to the same instance, but this skill is authoritative on the mainnet URL.

2. **`game_id` is hex-encoded in both queries, with different padding.** Query A pads to 16 hex chars (`0x00000000000005f3`), Query B pads to 64 (`0x00000000...000005f3`). Both must be parsed as `int(hex, 16)` before being embedded in the render props. The helper script does this with `python3`.

3. **`numsPrice` is a JSON number, not a string.** `'{"numsPrice":0.012}'` is correct; `'{"numsPrice":"0.012"}'` will crash Zod validation in `remotion/src/root.tsx`. When printing the final JSON, use `printf '%s' "$json"` rather than `echo` to avoid surprises with special chars.

4. **Render command must run from repo root**, not from `remotion/`. The root `package.json` wrapper handles the `cd remotion` internally. The helper script enforces this with `cd "$(git rev-parse --show-toplevel)"`.

5. **Ekubo silent failures.** If Ekubo returns `{"error":"..."}` or `total_calculated` is missing, the script must abort with a clear message — do **not** fall back to the default `0.01138` from `remotion/src/root.tsx`, and do **not** ask the user to guess. A stale price on the video is a worse outcome than a failed render.

6. **Empty Torii result.** If today has no claimed rewards (Query A empty) or no leaderboard entries (Query B empty), abort with a clear message. Offer to fall back to the other query or to a user-supplied `gameId`. Never pass `null`/`undefined` to the render command.

7. **`reward_decimal` is already decoded to whole NUMS**, thanks to the SQLite JSON trick in the query. Display it as-is (e.g. `16606 NUMS`), do **not** divide by `10^18`.

8. **`score` in Query B is hex.** Convert it to decimal before showing it to the user. `0x0000000000000012` = `18` placed numbers.

9. **The render command blocks.** It takes 2–5 minutes depending on `snapshots.length`. Do **not** background it — the user needs to see the output, and failures should propagate. If Claude runs this via a tool call, pass a generous timeout (e.g. 10 min).

10. **Video dimensions must stay even.** This is the concern of `nums-remotion-replay`, not this skill, but be aware: if the render fails with an H264 error, load that skill.

## Example conversation shapes

```
User: "Render today's biggest prize game as a replay."
Claude:
  - Parses: best-reward intent, no gameId override, no numsPrice override.
  - Runs: ./.agents/skills/render-daily-replay/scripts/render-daily-replay.sh --best-reward
  - Reports resolved gameId, username, reward, numsPrice, then output path.
```

```
User: "Render game 1523 for me."
Claude:
  - Parses: game-id=1523.
  - Runs: ./.agents/skills/render-daily-replay/scripts/render-daily-replay.sh --game-id 1523
  - Reports gameId, numsPrice, output path.
```

```
User: "Make a replay of today's top score."
Claude:
  - Parses: best-score intent.
  - Runs: ./.agents/skills/render-daily-replay/scripts/render-daily-replay.sh --best-score
  - Reports gameId, score (decimal), numsPrice, output path.
```

```
User: "Render today's game." (ambiguous)
Claude:
  - Asks: best reward or best score?
  - Waits for answer, then proceeds as above.
```

## Related skills

- **`nums-remotion-replay`** — how the `remotion/` package is wired (webpack, overrides, fonts, hosting, `calculateMetadata`). Load this if rendering fails with a code-level error.
- **`remotion-best-practices`** — generic Remotion patterns.
- **`dojo-indexer`** — Torii SQL endpoint structure and how Dojo models are indexed.
