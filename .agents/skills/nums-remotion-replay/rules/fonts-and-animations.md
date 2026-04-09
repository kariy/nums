---
name: fonts-and-animations
description: PixelGame font loading, SlidingNumber re-measure, framer-motion vs Remotion frame clock desync. Render-vs-studio issues and fixes.
metadata:
  tags: fonts, animations, framer-motion, sliding-number, render-quirks
---

## The three pain points

1. **Fonts load asynchronously** → components that measure their size on mount get the fallback-font metrics
2. **framer-motion `useSpring` uses real-time `requestAnimationFrame`** → desync with Remotion's frame-by-frame render clock
3. **Animations that look fine in the Studio tremble in the rendered MP4**

## Font loading

Fonts must be available BEFORE any frame is captured. Solution: load them via JS with `delayRender` to block capture until they're ready.

### `remotion/src/fonts.ts`

```ts
import { useState, useEffect } from "react";
import { staticFile, continueRender, delayRender } from "remotion";

const FONT_DEFINITIONS = [
  {
    family: "PixelGame",
    src: "assets/fonts/pixel-game.regular.otf",
    weight: "400",
  },
  {
    family: "PPNeueBit",
    src: "assets/fonts/pp-neue-bit.bold.otf",
    weight: "700",
  },
  {
    family: "Circular-LL",
    src: "assets/fonts/circular-ll.regular.ttf",
    weight: "400",
  },
  {
    family: "Circular-LL",
    src: "assets/fonts/circular-ll.medium.ttf",
    weight: "500",
  },
  // ...
] as const;

export function useFonts() {
  const [handle] = useState(() => delayRender("Loading fonts"));

  useEffect(() => {
    Promise.all(
      FONT_DEFINITIONS.map(({ family, src, weight }) => {
        const font = new FontFace(family, `url(${staticFile(src)})`, {
          weight,
          display: "block",
        });
        return font.load().then((loaded) => document.fonts.add(loaded));
      }),
    )
      .then(() => document.fonts.ready)
      .then(() => continueRender(handle));
  }, [handle]);
}
```

**Critical**: `delayRender` MUST be called during the initial render (inside `useState` initializer), NOT inside `useEffect`. If called in `useEffect`, Remotion captures the frame BEFORE the delay is registered.

### `SlidingNumber` re-measures after fonts load

The `SlidingNumber` component uses `react-use-measure` to get the digit roller height. On first render, the measurement uses the fallback font (wrong height). When PixelGame loads, the roller glyphs are a different size, and the `translateY` calculation is off → digits overlap.

Fix: force a remount after `document.fonts.ready` by using a `key` prop:

```tsx
const [measureRef, { height }] = useMeasure();
const [fontsReady, setFontsReady] = useState(false);

useEffect(() => {
  document.fonts.ready.then(() => setFontsReady(true));
}, []);

return (
  <span
    ref={measureRef}
    key={fontsReady ? "ready" : "loading"} // ← remount triggers re-measure
  >
    {/* ... */}
  </span>
);
```

This lives in `client/src/components/ui/sliding-number.tsx` so it benefits the client too (hot reload scenarios).

## framer-motion ↔ Remotion frame clock desync

### The problem

framer-motion's `useSpring` advances based on `requestAnimationFrame` with real wall-clock time deltas. Remotion's render loop sets the page clock frame by frame. During render (both CLI and Studio "Render Video" button), the two clocks don't mesh:

- **At 30fps**: Δt = 33.3ms — too coarse for spring integration, numbers shiver instead of rolling smoothly
- **At 60fps**: Δt = 16.6ms — better but still visible artifacts

Studio PREVIEW works fine because rAF runs at real time, uninterrupted.

### The fix

Disable framer-motion animations during render ONLY:

```tsx
import { getRemotionEnvironment } from "remotion";
import { MotionConfig } from "framer-motion";

const { isRendering } = getRemotionEnvironment();

return (
  <MotionConfig reducedMotion={isRendering ? "always" : "never"}>
    <GameScene /* ... */ />
  </MotionConfig>
);
```

`reducedMotion="always"` tells framer-motion to skip all tween/spring animations and jump straight to the final value. Numbers snap to their target — no rolling animation during render, but no shivering either.

**Trade-off**: The render loses the rolling digit animation. If you need the animation in the video, use Remotion's own `interpolate` / `spring` from `remotion` instead of framer-motion.

## SlidingNumber clipping issues

The `SlidingNumber` uses `overflow: hidden` on each roller to clip the non-current digits. Remotion Studio sometimes renders parent transforms that break `overflow: hidden` (digits visible above/below).

Belt-and-suspenders fix in the roller:

```tsx
<span
  ref={measureRef}
  style={{
    overflow: "visible",
    clipPath: "inset(-4px -2px)",
    WebkitClipPath: "inset(-4px -2px)",
  }}
>
```

- `clipPath: inset(-4px -2px)` clips strictly in the paint layer (unaffected by transforms) with a 4px vertical / 2px horizontal overflow to let `text-shadow` escape without exposing adjacent digits
- Inline style (not Tailwind) to avoid CSS specificity issues in the Studio's stylesheet

## Leading / line-height for `SlidingNumber`

The roller's line-height determines the vertical digit spacing. Two modes:

- **`leading="none"`** (default) — roller uses `leading-none` (`line-height: 1 = 1em`). Each digit is exactly `font-size` tall. Use this when the parent context has `line-height < font-size` (e.g. `text-[80px]/[54px]`) and you want digits to NOT visually touch.
- **`leading="inherit"`** — roller inherits parent `line-height`. Use this for small text where `line-height` > `font-size` and you want the original parent spacing preserved (e.g. slots that use `text-lg/5`).

Exposed via CVA variants in `client/src/components/ui/sliding-number.tsx`:

```tsx
<SlidingNumber number={value} leading="inherit" />
```

## Recap: render-safe animations

| Scenario                                 | Solution                                     |
| ---------------------------------------- | -------------------------------------------- |
| Text font not loaded → wrong size        | `useFonts()` + `delayRender`                 |
| `SlidingNumber` dimensions off in Studio | `key={fontsReady}` remount                   |
| Spring animations tremble in render      | `<MotionConfig reducedMotion={isRendering}>` |
| Digits bleed outside roller              | Inline `clipPath: inset(-4px -2px)`          |
| Text shadow cut off                      | Negative `clipPath` inset                    |

## Related

- `.agents/skills/remotion-best-practices/rules/fonts.md` — Canonical Remotion font loading API
- `.agents/skills/remotion-best-practices/rules/timing.md` — Use Remotion's `interpolate`/`spring` as alternative to framer-motion
- `.agents/skills/remotion-best-practices/rules/measuring-dom-nodes.md` — DOM measurement patterns
