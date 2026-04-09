---
name: nums-remotion-replay
description: Project-specific skill for the Nums Remotion package that generates game replay videos by reusing the existing client React components. Covers the cross-package webpack setup, client-component overrides, Torii data fetching, font loading, render flow quirks, and hosting. Use when working on `remotion/` or the `SlidingNumber` component, adding new compositions, debugging font/animation issues, or setting up hosting for the Remotion Studio. Pairs with the generic `remotion-best-practices` skill.
metadata:
  tags: remotion, nums, replay, video, game, cross-package, client-components
---

## When to use

Load this skill when:

- Working in the `remotion/` workspace package
- Adding a new composition that reuses client components
- Debugging font loading, animation desync, or webpack alias issues
- Fetching game state from Torii for a replay
- Setting up hosting for the Remotion Studio (Railway, Render.com, etc.)
- Modifying the `SlidingNumber` component in `client/src/components/ui/sliding-number.tsx`

For generic Remotion patterns (compositions, sequencing, timing, fonts API, transitions, Tailwind in Remotion), **also load** `remotion-best-practices`.

## Core principle

The `remotion/` package **reuses** the client's existing React components (`GameScene`, `WelcomeScene`, `GameOver`, `Num`, `Slot`, etc.) via a webpack `@/` alias pointing to `client/src/`. **No duplication.** Visual fidelity with the live game is guaranteed because the exact same components render in both contexts.

The trade-off: Remotion uses webpack, but the client is a Vite app. Several Vite-only patterns must be shimmed in the Remotion webpack config (`import.meta.env`, absolute `/assets/foo.svg` imports, etc.).

## Project structure

```
remotion/
├── package.json              # @cartridge/nums-remotion workspace package
├── tsconfig.json             # paths: @/* → ../client/src/*
├── remotion.config.ts        # webpack aliases, DefinePlugin, WASM
├── tailwind.config.ts        # reuses client's preset, forces mobile breakpoints
├── postcss.config.js
├── src/
│   ├── index.ts              # registerRoot(RemotionRoot)
│   ├── root.tsx              # single `replay` Composition + calculateMetadata
│   ├── replay.tsx            # intro → game → outro + audio
│   ├── types.ts              # GameSnapshot interface
│   ├── fonts.ts              # useFonts() hook with delayRender
│   ├── styles.css            # imports client themes + @font-face
│   ├── data/
│   │   └── torii.ts          # fetchGameReplay() SQL query + unpacking
│   └── overrides/
│       ├── countup.tsx       # replaces @/components/animations/countup
│       └── numbers-svg.ts    # replaces /assets/numbers.svg import
```

## Rule files

- [rules/webpack-setup.md](rules/webpack-setup.md) — Cross-package webpack aliases, `import.meta.env` shimming, client-component overrides, WASM support
- [rules/torii-data.md](rules/torii-data.md) — Fetching game state from Torii SQL, unpacking Power/Trap bitmasks, `calculateMetadata` pattern
- [rules/fonts-and-animations.md](rules/fonts-and-animations.md) — PixelGame font loading via `delayRender`, `SlidingNumber` re-measure after `document.fonts.ready`, `MotionConfig reducedMotion` for render-vs-studio desync
- [rules/hosting.md](rules/hosting.md) — Why Vercel doesn't work, Railway/Render.com/Fly.io setup, licensing considerations, Lambda alternative

## Quick commands

From the repo root:

```bash
# Studio (local dev, hot reload)
pnpm remotion:studio

# Render a specific game (needs Torii reachable)
pnpm remotion:render:game '{"gameId":343,"numsPrice":0.0115}'

# Render a single frame (fast sanity check)
npx -C remotion remotion still src/index.ts replay out/frame.png --frame=60 --props='{"gameId":343,"numsPrice":0.0115}'
```

From the `remotion/` directory:

```bash
pnpm studio
pnpm render
pnpm render:game '{"gameId":343}'
```

## Non-obvious gotchas (READ FIRST)

1. **Video dimensions must be even**. H264 rejects odd widths/heights. `width=376` is OK, `width=375` will error at render time.

2. **The Studio URL cannot be used for routing**. When the user clicks "Render Video" in the Studio at `/some-path/1102`, the render's headless browser strips the path. Don't rely on `window.location.pathname` for composition registration. Use `defaultProps` populated from the Studio's props panel or CLI `--props`.

3. **framer-motion + Remotion frame clock desync**. framer-motion's `useSpring` runs on real-time `requestAnimationFrame`. During render, Remotion advances the clock frame-by-frame. This causes shivering/trembling animations. Fix: wrap the render tree in `<MotionConfig reducedMotion={isRendering ? "always" : "never"}>` using `getRemotionEnvironment().isRendering`.

4. **Fonts load AFTER the first render in the Studio**. If a component (like `SlidingNumber`) measures its dimensions on mount, it gets the fallback-font height, not PixelGame's. Re-measure after `document.fonts.ready` or use `delayRender` to block the first capture until fonts are loaded.

5. **Client components that use `import foo from "/assets/bar.svg"` (Vite absolute path) break webpack**. Create an override in `remotion/src/overrides/` that uses `staticFile()` and alias the resolved file path in `remotion.config.ts`. See [rules/webpack-setup.md](rules/webpack-setup.md).

6. **Mobile breakpoints**. The client uses Tailwind `md:` for desktop layout (768px). In Remotion Studio, the browser viewport is wider than 768px, so `md:` styles fire, showing the desktop layout at a 376px composition width → broken. `remotion/tailwind.config.ts` forces all breakpoints to `9999px` so `md:` never triggers → mobile layout always wins.

7. **`Power.from(n)` and `Power.index()` are NOT inverses**. `Power.from(1)` returns `Reroll` (enum index), but `Power(Reroll).index()` returns `0` (custom mapping). When storing/restoring powers, use `Power.into()` ↔ `Power.from()` — NOT `Power.index()` ↔ `Power.from()`.

## Related skills

- **`remotion-best-practices`** — Generic Remotion patterns (compositions, timing, sequencing, transitions, Zod schemas, audio, images, Tailwind)
- **`ui-architecture`** — Client component conventions (CVA variants, `data-slot`, Radix primitives)
- **`shadcn`** — Managing shadcn/ui components (where `SlidingNumber` came from)
