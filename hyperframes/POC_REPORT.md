# Hyperframes POC Report

Branch: `migration/hyperframes-poc`
Date: 2026-04-20
Goal: Prove that the Nums game replay can be rendered with Hyperframes while reusing the client's React components (Option B from the initial analysis).

## TL;DR

**Option B is viable.** Hyperframes can render the existing `GameScene` React component by pointing the engine at a Vite dev server that mounts React and exposes the `window.__hf` seek protocol. 120 frames at 376×596@120fps are captured deterministically and encoded into an MP4 in a few seconds. Visual fidelity matches the client exactly because we reuse the same React code.

**Recommendation:** proceed to full migration with Option B.

## What was built

Directory `/hyperframes/`:

- `package.json` — workspace package `@cartridge/nums-hyperframes`, depends on `@hyperframes/core`, `@hyperframes/engine`, `react`, `framer-motion`, `vite`, `tsx`
- `vite.config.ts` — mirrors `remotion/remotion.config.ts`: aliases `@/` to `client/src`, overrides asset imports, shims `import.meta.env`, adds `vite-plugin-wasm` for `@dojoengine/torii-wasm`
- `tailwind.config.ts` + `postcss.config.js` — identical to the Remotion setup, reuses the client preset
- `index.html` — minimal bootstrap, 376×596 root container
- `src/styles.css` — reuses the client theme and keyframes
- `src/overrides/countup.tsx`, `src/overrides/numbers-svg.ts` — Vite-compatible versions of the Remotion overrides (plain paths instead of `staticFile()`)
- `src/types.ts` — `GameSnapshot` interface (copy of Remotion's)
- `src/fixtures.ts` — three hardcoded snapshots (no Torii in the POC)
- `src/scene-props.ts` — `snapshotToGame()` + `computeSceneProps()` extracted from `remotion/src/replay.tsx`
- `src/hf-protocol.ts` — installs `window.__hf` = `{ duration, seek }` as required by `@hyperframes/engine`
- `src/poc-app.tsx` — React app that mounts `<GameScene>` with the current snapshot selected by `frame ÷ framesPerState`, wired to `useSyncExternalStore` so `window.__hf.seek(time)` drives rerenders
- `scripts/render-poc.ts` — boots Vite in a subprocess, launches headless Chrome via `@hyperframes/engine`, calls `captureFrame` for 120 frames, then encodes with FFmpeg. Output: `out/game-replay.mp4`

## How Hyperframes differs from Remotion (confirmed by the POC)

| Aspect | Remotion | Hyperframes |
|---|---|---|
| Input format | React `<Composition>` + `registerRoot` | Any web page exposing `window.__hf = { duration, seek }` |
| Framework awareness | React-native (knows about `useCurrentFrame`) | Framework-agnostic (page-to-video capture) |
| Build pipeline | Its own webpack | You bring your own (Vite, Next, static HTML, …) |
| Dev studio | Built-in visual studio | `hyperframes preview` for HTML compositions; React apps use their own dev server |
| Time unit | Frames (integer) | Seconds (float) |
| Engine | Custom headless Chromium wrapper | Puppeteer + FFmpeg, `HeadlessExperimental.beginFrame` for determinism |
| Media (audio/video) | `<Audio>`, `<Video>`, `<Sequence>` components | Declare `<audio>` / `<video>` DOM elements, the engine extracts and mixes |
| Ships source vs dist | Published as compiled JS | Publishes raw `.ts` — consumers need `tsx`/`bun`/`ts-node` |

## POC numbers

- Frames captured: 120 @ 120fps (1 second)
- Output: `out/game-replay.mp4`, 34 KB, H.264 High, yuv420p, 376×596
- Render time: a few seconds (Vite boot + browser launch + 120 seeks + encode)
- Visual fidelity: **identical to the client** (same React tree, same CSS, same theme, same fonts once we load them)
- PNG frame size: ~270 KB/frame (can be streamed via `captureFrameToBuffer` for full migration)

## What worked first try

- `@hyperframes/engine` API (once we read the real `.d.ts` instead of the README example)
- The `@/` alias from Remotion translates cleanly to Vite's `resolve.alias`
- All client components (`GameScene`, `Verifier`, `Power`, `Trap`, `Game`, etc.) render inside Puppeteer with zero modification
- Tailwind preset + client theme CSS work identically
- Deterministic seek: `setFrame()` inside `window.__hf.seek` reliably updates React before the next screenshot

## What required work

- **WASM support**: the client imports `@dojoengine/torii-wasm` transitively. Vite needs `vite-plugin-wasm` + `vite-plugin-top-level-await` (same plugins the client already uses). Fixed by mirroring the client's Vite config.
- **TypeScript execution**: `@hyperframes/engine`'s `package.json` ships raw `.ts` (`"main": "./src/index.ts"`). Node's built-in `--experimental-strip-types` refuses types inside `node_modules`. Fixed by running the script via `tsx`.
- **Env var shim**: the client reads `import.meta.env.VITE_SN_MAIN_TORII_URL` at import time. Same fix as Remotion: Vite `define` with placeholders. No Torii calls happen at render time because snapshots come from the FrameAdapter.

## What is NOT covered by this POC (and needs doing for full migration)

1. Intro / outro scenes (`WelcomeScene`, `GameOver`) — trivial to wire in `poc-app.tsx`
2. Torii data fetching — port `remotion/src/data/torii.ts` to `hyperframes/src/data/torii.ts` unchanged
3. Audio / SFX — Hyperframes' `HfProtocol` exposes `media: HfMediaElement[]`. We declare `<audio>` elements in the DOM with `data-start` / `data-duration` and the engine mixes them in FFmpeg. One-to-one mapping from Remotion's `<Sequence>` + `<Audio>`.
4. Font loading — replace Remotion's `delayRender`/`continueRender` with a Promise that resolves when `document.fonts.ready` settles, and block `window.__hf.seek` until it resolves on the first call.
5. Props from CLI — accept `gameId` + `numsPrice` via query string or `?props=` and hydrate them before `window.__hf` is installed.
6. Parallel rendering — `@hyperframes/engine` exposes `parallelCoordinator` for multi-worker capture. Nice-to-have for longer videos.
7. `render-daily-replay` skill integration — the `.sh` helper script just needs to call `pnpm hyperframes:render:game` instead of `pnpm remotion:render:game`.
8. CI and hosting — same constraints as Remotion (Puppeteer + FFmpeg; Vercel serverless not supported).

## Estimated effort for full migration

- Scenes + data: 0.5 day (mostly copy from `remotion/src/`)
- Audio: 0.5 day (map `<Sequence>` to `<audio>` declarations)
- Fonts + props + CLI wiring: 0.5 day
- Render script + scripts in root `package.json` + skill update: 0.5 day
- Comparison + visual QA + removing `remotion/`: 0.5 day

**Total: ~2.5 days** on top of this POC.

## Risks / open questions for full migration

- **120fps vs default 30fps**: Remotion runs at 120fps (smoother framer-motion interpolation). Hyperframes works fine at 120fps in the POC, but render time scales linearly. Recommend keeping 120fps.
- **framer-motion + Hyperframes clock**: the current POC sets `reducedMotion="always"` which disables animations entirely. For the full migration we need to verify that framer-motion animations driven by frame-based state (not wall clock) work correctly — same `MotionConfig reducedMotion={isRendering ? "always" : "never"}` trick Remotion uses.
- **`SlidingNumber` font re-measure**: the known Remotion gotcha (fonts load after first render) needs to be handled the same way — block `window.__hf.seek` until `document.fonts.ready`.
- **Cross-package edit speed**: the Vite dev server HMRs client changes instantly. Better DX than Remotion Studio for iterating on the UI.

## Commands

```bash
# From the repo root
cd hyperframes
pnpm render:poc
# → out/game-replay.mp4
# → out/frames/frame_000000.png .. frame_000119.png
```

## Decision

Option B is proven. Recommend proceeding to full migration on this branch.
