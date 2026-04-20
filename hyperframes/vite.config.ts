import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "node:path";

/**
 * Vite config for the Hyperframes POC.
 *
 * Mirrors remotion/remotion.config.ts so the client components render
 * identically. We reuse the client's source directly via the `@/` alias
 * and the public assets via the `/assets`, `/sounds`, `/musics` aliases.
 */
export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, "..", "client", "public"),
  server: {
    port: 5180,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 5181,
    strictPort: true,
    host: "127.0.0.1",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "..", "client", "src"),
      // Replicate Remotion overrides so the imported client components
      // keep working without touching client/ source.
      [path.resolve(
        __dirname,
        "..",
        "client",
        "src",
        "components",
        "animations",
        "countup",
      )]: path.resolve(__dirname, "src", "overrides", "countup.tsx"),
      "/assets/numbers.svg": path.resolve(
        __dirname,
        "src",
        "overrides",
        "numbers-svg.ts",
      ),
    },
  },
  define: {
    // Shim Vite env vars used by client code at runtime. The Hyperframes
    // runtime never hits Torii directly — snapshots are injected via the
    // FrameAdapter — so placeholders are fine.
    "import.meta.env.VITE_DEFAULT_CHAIN": JSON.stringify("SN_MAIN"),
    "import.meta.env.VITE_SN_MAIN_RPC_URL": JSON.stringify(""),
    "import.meta.env.VITE_SN_SEPOLIA_RPC_URL": JSON.stringify(""),
    "import.meta.env.VITE_SN_MAIN_TORII_URL": JSON.stringify(
      "https://placeholder/torii/v1",
    ),
    "import.meta.env.VITE_SN_SEPOLIA_TORII_URL": JSON.stringify(
      "https://placeholder/torii/v1",
    ),
  },
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["@dojoengine/torii-wasm"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
