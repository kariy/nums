#!/usr/bin/env bash
set -euo pipefail

TORII_SQL_URL="https://api.cartridge.gg/x/nums-mainnet/torii/sql"

EKUBO_CHAIN_ID="23448594291968334"
NUMS_TOKEN="0x2e82800f97afded96e8e88f9788f2d8f097edb04c9e9b920ceb1ec11f265158"
QUOTE_TOKEN="0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb"
EKUBO_AMOUNT="100000000000000000000"
EKUBO_URL="https://prod-api-quoter.ekubo.org/${EKUBO_CHAIN_ID}/${EKUBO_AMOUNT}/${NUMS_TOKEN}/${QUOTE_TOKEN}"

# Source-of-truth references (verify before editing any constant above):
#   TORII_SQL_URL   = client/.env.production → VITE_SN_MAIN_TORII_URL + "/sql"
#   EKUBO_CHAIN_ID  = decimal of shortString.encodeShortString("SN_MAIN")
#   NUMS_TOKEN      = manifest_mainnet.json → NUMS-Token.address
#   QUOTE_TOKEN     = client/.env.production → VITE_SN_MAIN_QUOTE
#   EKUBO_AMOUNT    = 100 * 10^18 (100 NUMS scaled by token decimals)

# shellcheck disable=SC2016
QUERY_BEST_REWARD='SELECT
    c.username,
    g.game_id,
    g.player_id AS player,
    ('"'"'0x'"'"' || LTRIM(SUBSTR(g.reward, 3), '"'"'0'"'"') ->> '"'"'$'"'"') AS reward_decimal,
    g.internal_executed_at
FROM "NUMS-Claimed" AS g
JOIN controllers AS c ON c.address = g.player_id
WHERE DATE(g.internal_executed_at) = DATE('"'"'now'"'"')
ORDER BY reward_decimal DESC
LIMIT 1;'

QUERY_BEST_SCORE='SELECT
    g.game_id,
    g.score
FROM "NUMS-LeaderboardScore" AS g
WHERE DATE(g.internal_executed_at) = DATE('"'"'now'"'"')
ORDER BY score DESC
LIMIT 1;'

die() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

hex_to_decimal() {
  local hex="$1"
  [[ -z "$hex" || "$hex" == "null" ]] && die "hex_to_decimal: empty input"
  python3 -c "import sys; print(int('$hex', 16))"
}

usage() {
  cat <<'USAGE'
render-daily-replay.sh — resolve gameId + numsPrice and invoke the render

Usage:
  render-daily-replay.sh --best-reward               today's top reward via Torii
  render-daily-replay.sh --best-score                today's top score via Torii
  render-daily-replay.sh --game-id <N>               render a specific gameId
  render-daily-replay.sh <any-mode> --dry-run        print the final command, don't render
  render-daily-replay.sh <any-mode> --nums-price <P> override auto-fetched price

Exactly one of --best-reward / --best-score / --game-id is required.
USAGE
}

MODE=""
GAME_ID_OVERRIDE=""
NUMS_PRICE_OVERRIDE=""
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --best-reward)
      [[ -n "$MODE" ]] && die "cannot combine --best-reward with --$MODE"
      MODE="best-reward"
      shift
      ;;
    --best-score)
      [[ -n "$MODE" ]] && die "cannot combine --best-score with --$MODE"
      MODE="best-score"
      shift
      ;;
    --game-id)
      [[ -n "$MODE" ]] && die "cannot combine --game-id with --$MODE"
      MODE="game-id"
      [[ $# -ge 2 ]] || die "--game-id requires a value"
      GAME_ID_OVERRIDE="$2"
      shift 2
      ;;
    --nums-price)
      [[ $# -ge 2 ]] || die "--nums-price requires a value"
      NUMS_PRICE_OVERRIDE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
done

[[ -z "$MODE" ]] && {
  usage >&2
  die "one of --best-reward / --best-score / --game-id is required"
}

require_cmd curl
require_cmd jq
require_cmd python3
require_cmd pnpm
require_cmd git

# Must run from repo root: the `pnpm remotion:render:game` wrapper already
# handles `cd remotion` internally, so chdir into `remotion/` here would
# break workspace resolution.
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

GAME_ID=""
SUMMARY_LABEL=""

case "$MODE" in
  best-reward)
    echo "→ fetching today's best reward from Torii…"
    RESPONSE="$(curl -sSfG "$TORII_SQL_URL" --data-urlencode "query=$QUERY_BEST_REWARD")"
    COUNT="$(echo "$RESPONSE" | jq 'length')"
    [[ "$COUNT" -eq 0 ]] && die "no claimed rewards found for today; try --best-score or --game-id"

    GAME_ID_HEX="$(echo "$RESPONSE" | jq -r '.[0].game_id')"
    USERNAME="$(echo "$RESPONSE" | jq -r '.[0].username')"
    REWARD="$(echo "$RESPONSE" | jq -r '.[0].reward_decimal')"
    EXEC_AT="$(echo "$RESPONSE" | jq -r '.[0].internal_executed_at')"
    GAME_ID="$(hex_to_decimal "$GAME_ID_HEX")"
    SUMMARY_LABEL="best reward — ${USERNAME} won ${REWARD} NUMS (game ${GAME_ID}) at ${EXEC_AT}"
    ;;
  best-score)
    echo "→ fetching today's best score from Torii…"
    RESPONSE="$(curl -sSfG "$TORII_SQL_URL" --data-urlencode "query=$QUERY_BEST_SCORE")"
    COUNT="$(echo "$RESPONSE" | jq 'length')"
    [[ "$COUNT" -eq 0 ]] && die "no leaderboard scores found for today; try --best-reward or --game-id"

    GAME_ID_HEX="$(echo "$RESPONSE" | jq -r '.[0].game_id')"
    SCORE_HEX="$(echo "$RESPONSE" | jq -r '.[0].score')"
    GAME_ID="$(hex_to_decimal "$GAME_ID_HEX")"
    SCORE="$(hex_to_decimal "$SCORE_HEX")"
    SUMMARY_LABEL="best score — game ${GAME_ID} with ${SCORE} placed numbers"
    ;;
  game-id)
    [[ "$GAME_ID_OVERRIDE" =~ ^[0-9]+$ ]] || die "--game-id must be a decimal integer, got: $GAME_ID_OVERRIDE"
    GAME_ID="$GAME_ID_OVERRIDE"
    SUMMARY_LABEL="user-specified game ${GAME_ID}"
    ;;
esac

NUMS_PRICE=""
if [[ -n "$NUMS_PRICE_OVERRIDE" ]]; then
  [[ "$NUMS_PRICE_OVERRIDE" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "--nums-price must be a decimal number, got: $NUMS_PRICE_OVERRIDE"
  NUMS_PRICE="$NUMS_PRICE_OVERRIDE"
  echo "→ numsPrice: ${NUMS_PRICE} (user override)"
else
  echo "→ fetching current NUMS price from Ekubo…"
  EKUBO_RESPONSE="$(curl -sSf "$EKUBO_URL")" || die "Ekubo request failed"

  # Abort on explicit error payloads or missing field. A stale/guessed price
  # would silently produce a misleading video, which is a worse outcome than
  # a loud failure. Never fall back to the default 0.01138 from root.tsx.
  if echo "$EKUBO_RESPONSE" | jq -e 'has("error")' >/dev/null 2>&1; then
    ERR_MSG="$(echo "$EKUBO_RESPONSE" | jq -r '.error')"
    die "Ekubo returned error: $ERR_MSG"
  fi

  TOTAL_CALCULATED="$(echo "$EKUBO_RESPONSE" | jq -r '.total_calculated // empty')"
  [[ -z "$TOTAL_CALCULATED" ]] && die "Ekubo response missing total_calculated: $EKUBO_RESPONSE"

  # Formula mirrors client/src/context/prices.tsx → fetchTokenUsdPrice():
  #   numsPrice = total_calculated / 1e6 / 100
  # where /1e6 undoes USDC 6-decimal scaling and /100 normalizes the 100 NUMS input.
  NUMS_PRICE="$(python3 -c "print(round(int('$TOTAL_CALCULATED') / 1e6 / 100, 8))")"
  echo "→ numsPrice: ${NUMS_PRICE} (auto-fetched)"
fi

PROPS_JSON="$(jq -n --argjson gameId "$GAME_ID" --argjson numsPrice "$NUMS_PRICE" \
  '{gameId: $gameId, numsPrice: $numsPrice}' --compact-output)"

echo ""
echo "───────────────────────────────────────────────"
echo " mode:       $MODE"
echo " summary:    $SUMMARY_LABEL"
echo " gameId:     $GAME_ID"
echo " numsPrice:  $NUMS_PRICE"
echo " props:      $PROPS_JSON"
echo "───────────────────────────────────────────────"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[dry-run] would execute:"
  echo "  pnpm remotion:render:game '$PROPS_JSON'"
  exit 0
fi

echo "→ rendering (this takes ~2–5 min, output blocks until done)…"
pnpm remotion:render:game "$PROPS_JSON"

OUTPUT_PATH="$REPO_ROOT/remotion/out/game-replay.mp4"
if [[ -s "$OUTPUT_PATH" ]]; then
  SIZE="$(ls -lh "$OUTPUT_PATH" | awk '{print $5}')"
  echo ""
  echo "✔ render complete"
  echo "  file: $OUTPUT_PATH"
  echo "  size: $SIZE"
else
  die "render finished but output missing or empty: $OUTPUT_PATH"
fi
