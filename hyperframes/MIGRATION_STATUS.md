# Remotion -> Hyperframes migration status

Branch: `migration/hyperframes-poc`

## What is done

### Step 0 — POC (commit `3f87d78`)

Hyperframes can render the existing `GameScene` React component by pointing the engine at a Vite dev server that mounts React and exposes `window.__hf`. 120 frames @ 376x596 @ 120fps, visually identical to the client. See commit message for the full scaffold list.

### Step 1 — Intro + Outro scenes (commit in step 1)

`src/replay.tsx` now switches between `WelcomeScene` (frame < introFrames), `GameScene` (game range), and `GameOver` (frame >= introFrames + snapshots * framesPerState). `src/frame-store.ts` is the external store driven by `window.__hf.seek`. Verified visually: frame 0 -> NUMS.GG logo, frame 60+ -> board, frame 200 -> GameOver modal with score/payout/value.

### Step 2 — Torii data fetching (commit `82d614a`)

`src/data/torii.ts` is a byte-for-byte port of `remotion/src/data/torii.ts`. `src/main.tsx` reads `gameId` and `numsPrice` from `window.location.search` and awaits `fetchGameReplay()` before mounting `<Replay />` and installing the `__hf` protocol. Because `__hf` is set only after the data resolves, the engine's `initializeSession()` blocks until the app is ready — same effect as Remotion's `calculateMetadata`.

Also moved defaults to the real Remotion values: `INTRO_FRAMES = 600`, `FRAMES_PER_STATE = 120`, `OUTRO_FRAMES = 600`. The `POC_SNAPSHOTS` fixture is still used when no `gameId` is provided, for fast local iteration.

### Step 3 — Audio timeline (commit `8ff0be9`)

`src/audio-timeline.ts` re-implements `computeSfxEvents()` from `remotion/src/replay.tsx` plus a background-music cue, producing `AudioCue[]` with second-based `start`/`end`. `src/replay.tsx` renders each cue as a hidden `<audio id src data-start data-end data-volume />` node. The render script (`scripts/render-game.ts`) fetches the served HTML after capture, runs `parseAudioElements` + `processCompositionAudio` to mix tracks, then `muxVideoWithAudio` to produce the final MP4 with AAC stereo.

Known issue: the muxed MP4 reports a truncated duration (0.2s vs the expected 2s from the test run). To investigate in step 8 — likely a flag mismatch in `muxVideoWithAudio` or an off-by-one in the audio element `data-end` values.

### Step 4 — Font loading (commit `c607a2c`)

`src/fonts.ts` loads the 6 client fonts (PixelGame, PPNeueBit, DMMono-Regular, 3x Circular-LL*) via `FontFace` with `display: block`, awaits `document.fonts.ready`, and resolves. `src/main.tsx` calls `await loadFonts()` inside `bootstrap()` BEFORE `installHyperframesProtocol()`, so the engine waits for fonts in its `__hf not ready` loop.

### Step 5 — CLI props + dynamic duration (commit `7a7b5e4`)

`scripts/render-poc.ts` renamed to `scripts/render-game.ts` and rewritten:

- Accepts `gameId` / `numsPrice` as a JSON blob (`pnpm render:game '{"gameId":343,"numsPrice":0.0115}'`), named flags (`--game-id N --nums-price P`), or env vars (`GAME_ID=343 NUMS_PRICE=0.0115`)
- Forwards them as `?gameId=&numsPrice=` to the Vite URL so the React bootstrap fetches from the right Torii entity
- Queries `getCompositionDuration(session)` after `initializeSession` and uses that as the capture loop length and audio mix duration — no more hardcoded frame counts

`package.json` exposes `render`, `render:game` (kept the old `render:poc` name removed).

### Step 6 (partial) — Root scripts

`package.json` at the repo root now exposes `hyperframes:dev`, `hyperframes:render`, `hyperframes:render:game` alongside the existing `remotion:*` scripts. Both stacks coexist on the branch so we can A/B compare before deleting `/remotion`.

## What is left

### Step 6 (remainder) — skill `render-daily-replay`

Update `.agents/skills/render-daily-replay/scripts/render-daily-replay.sh` to call `pnpm hyperframes:render:game` instead of `pnpm remotion:render:game`. Update the SKILL.md wording and references. The JSON-blob argument shape is identical.

### Step 7 — Remove `/remotion`

- Delete the `/remotion` directory
- Remove `remotion` from `pnpm-workspace.yaml`
- Remove `remotion:*` scripts from the root `package.json`
- Remove `.agents/skills/remotion-best-practices/` and `.agents/skills/nums-remotion-replay/` (or convert them into a single `hyperframes-replay` skill that captures the lessons from the migration)

### Step 8 — End-to-end validation

1. Run `pnpm hyperframes:render:game '{"gameId":343,"numsPrice":0.0115}'` (or some other real gameId from mainnet) and let it render the full composition
2. Fix the duration truncation in `muxVideoWithAudio`. The video-only MP4 has the correct duration, so the bug is either in the mux args or in the audio WAV duration. Most likely culprit: when some SFX cues extend slightly past the total duration, the mixer produces a shorter audio file and the muxer uses `-shortest` by default
3. Side-by-side comparison vs the Remotion output: same gameId, same numsPrice, same frame count. Visual diff should be pixel-close except for font anti-aliasing differences between Remotion's bundled Chromium and Hyperframes' `chrome-headless-shell`

### Open questions

- **Font fidelity**: POC ran without custom fonts, so `PixelGame` / `Circular-LL` / etc. fell back to the browser default. Step 4 loads them — verify visually in step 8 that the board numbers match Remotion
- **framer-motion**: `replay.tsx` currently sets `MotionConfig reducedMotion="always"`, disabling animations entirely. Remotion uses `reducedMotion={isRendering ? "always" : "never"}` so the dev preview animates but renders are deterministic. We don't have `getRemotionEnvironment()` here; one option is to gate on `!!window.__hf` (true only in capture) or on a `HYPERFRAMES_RENDERING` data attribute. Validate in step 8.
- **Parallel rendering**: Hyperframes engine ships `parallelCoordinator` for multi-worker capture. A 30s composition = 3600 frames. Single-threaded capture is fine for a POC but may need parallelization for production throughput. Nice-to-have for later.

## How to run

Local dev (with fixtures, no Torii):

```bash
pnpm --filter @cartridge/nums-hyperframes dev
# open http://127.0.0.1:5180/
```

Render POC with fixtures:

```bash
pnpm hyperframes:render
```

Render a real game:

```bash
pnpm hyperframes:render:game '{"gameId":343,"numsPrice":0.0115}'
# or
pnpm hyperframes:render:game --game-id 343 --nums-price 0.0115
```

Outputs go to `hyperframes/out/game-replay.mp4`.
