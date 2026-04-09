---
name: webpack-setup
description: Cross-package webpack config for Remotion reusing client components. Aliases, import.meta.env shimming, asset overrides, WASM support.
metadata:
  tags: webpack, alias, vite, import-meta-env, overrides
---

## Goal

The Remotion package uses webpack. The client package uses Vite. Several Vite-only patterns must be shimmed so client code runs in Remotion's webpack bundle.

## The four webpack patches

All applied via `Config.overrideWebpackConfig()` in `remotion/remotion.config.ts`:

### 1. `@/*` alias → `client/src/`

Lets Remotion source use the same `@/components/...` imports as the client.

```ts
alias: {
  "@": path.resolve(process.cwd(), "..", "client", "src"),
}
```

Matches the `tsconfig.json` paths entry:

```json
"paths": {
  "@/*": ["../client/src/*"]
}
```

### 2. `import.meta.env` → static values via `DefinePlugin`

The client's `config.ts` reads `import.meta.env.VITE_*`. Webpack doesn't know `import.meta.env`. Shim it with a `DefinePlugin`:

```ts
new webpack.DefinePlugin({
  "import.meta.env": JSON.stringify({
    VITE_DEFAULT_CHAIN: "SN_MAIN",
    VITE_SN_MAIN_RPC_URL: "",
    VITE_SN_SEPOLIA_RPC_URL: "",
    VITE_SN_MAIN_TORII_URL: "https://placeholder/torii/v1",
    VITE_SN_SEPOLIA_TORII_URL: "https://placeholder/torii/v1",
  }),
}),
```

Values are placeholders — the Remotion bundle doesn't call these endpoints, they just need to exist so the client's module evaluation doesn't crash.

### 3. WebAssembly support

Client deps transitively pull in `@dojoengine/torii-wasm`. Enable async WASM:

```ts
experiments: {
  asyncWebAssembly: true,
}
```

### 4. Asset path aliases for Vite-style absolute imports

The client uses `import background from "/assets/numbers.svg"`. Vite resolves `/assets/...` to `public/assets/...`. Webpack doesn't. Alias them:

```ts
alias: {
  // ...
  "/assets": path.resolve(process.cwd(), "..", "client", "public", "assets"),
  "/sounds": path.resolve(process.cwd(), "..", "client", "public", "sounds"),
  "/musics": path.resolve(process.cwd(), "..", "client", "public", "musics"),
}
```

## Client-component override pattern

Some client files load assets via **runtime** `<img src="/assets/...">` (not an import). Webpack can't rewrite those strings. Solution: create a replacement file in `remotion/src/overrides/` that uses `staticFile()`, then alias the ORIGINAL file's absolute path to the override.

### Example 1: `countup.tsx` override

**Original** (`client/src/components/animations/countup.tsx`):

```tsx
<img src="/assets/animations/countup.svg" ... />
```

**Override** (`remotion/src/overrides/countup.tsx`):

```tsx
import { staticFile } from "remotion";
import { animationVariants, type AnimationProps } from "@/components/animations";

export const Countup = memo(forwardRef(
  ({ className, size, ...props }, ref) => (
    <img src={staticFile("assets/animations/countup.svg")} ... />
  ),
));
```

**Alias** in `remotion.config.ts`:

```ts
alias: {
  [path.resolve(
    process.cwd(), "..", "client", "src",
    "components", "animations", "countup",
  )]: path.resolve(process.cwd(), "src", "overrides", "countup.tsx"),
  // other aliases...
}
```

The KEY of the alias is the **absolute path** webpack would resolve (without extension). The VALUE is your override file.

### Example 2: SVG imported as module

**Original** (`client/src/components/scenes/welcome.tsx`):

```tsx
import background from "/assets/numbers.svg";
```

**Problem**: webpack resolves `/assets/numbers.svg` via the `/assets` alias to the actual SVG file. Then it tries to load it as an asset module, returning an asset URL. But Remotion's render server may not serve the asset at the expected URL.

**Override** (`remotion/src/overrides/numbers-svg.ts`):

```ts
import { staticFile } from "remotion";
const background = staticFile("assets/numbers.svg");
export default background;
```

**Alias** in `remotion.config.ts`:

```ts
alias: {
  "/assets/numbers.svg": path.resolve(
    process.cwd(), "src", "overrides", "numbers-svg.ts",
  ),
  // NOTE: this must come BEFORE the generic `/assets` alias, otherwise
  // webpack matches `/assets` first and treats the .svg as an asset.
  "/assets": path.resolve(/* ... */),
}
```

**Alias ordering matters**: more specific paths first, fallback generic last.

## Public directory

```ts
Config.setPublicDir(path.resolve(process.cwd(), "..", "client", "public"));
```

This lets `staticFile("assets/foo.svg")` resolve to `client/public/assets/foo.svg`. The client's existing asset tree is reused as-is.

## Tailwind breakpoint override

The client uses `md:` (768px) for desktop layout. In Remotion Studio, the browser viewport is wider than 768px, so `md:` fires, breaking the mobile layout. `remotion/tailwind.config.ts`:

```ts
theme: {
  screens: {
    sm: "9999px",
    md: "9999px",
    lg: "9999px",
    xl: "9999px",
    "2xl": "9999px",
  },
  // ...
}
```

All responsive classes become unreachable → mobile layout always.

## Full config reference

See `remotion/remotion.config.ts` for the current working setup.

## Troubleshooting

- **"Module not found: /assets/foo.svg"** → Missing `/assets` alias, or the specific alias isn't listed BEFORE the generic one.
- **"import.meta.env is undefined"** → `DefinePlugin` not applied, check config ordering.
- **"WebAssembly not allowed"** → Missing `experiments.asyncWebAssembly: true`.
- **Desktop layout in the Studio at 376px width** → Tailwind breakpoints not set to `9999px` in `remotion/tailwind.config.ts`.
- **Studio works but render (`remotion still`) fails with asset 404** → The asset is served via `<img src=...>` at runtime. Create an override that uses `staticFile()`.
