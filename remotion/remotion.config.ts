import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind";
import path from "path";
import webpack from "webpack";

Config.setPublicDir(path.resolve(process.cwd(), "..", "client", "public"));

Config.overrideWebpackConfig((currentConfiguration) => {
  const withTailwind = enableTailwind(currentConfiguration);

  return {
    ...withTailwind,
    experiments: {
      ...withTailwind.experiments,
      asyncWebAssembly: true,
    },
    resolve: {
      ...withTailwind.resolve,
      alias: {
        ...(withTailwind.resolve?.alias ?? {}),
        [path.resolve(
          process.cwd(),
          "..",
          "client",
          "src",
          "components",
          "animations",
          "countup",
        )]: path.resolve(process.cwd(), "src", "overrides", "countup.tsx"),
        "/assets/numbers.svg": path.resolve(
          process.cwd(),
          "src",
          "overrides",
          "numbers-svg.ts",
        ),
        "@": path.resolve(process.cwd(), "..", "client", "src"),
        "/assets": path.resolve(
          process.cwd(),
          "..",
          "client",
          "public",
          "assets",
        ),
        "/sounds": path.resolve(
          process.cwd(),
          "..",
          "client",
          "public",
          "sounds",
        ),
        "/musics": path.resolve(
          process.cwd(),
          "..",
          "client",
          "public",
          "musics",
        ),
      },
    },
    plugins: [
      ...(withTailwind.plugins ?? []),
      new webpack.DefinePlugin({
        "import.meta.env": JSON.stringify({
          VITE_DEFAULT_CHAIN: "SN_MAIN",
          VITE_SN_MAIN_RPC_URL: "",
          VITE_SN_SEPOLIA_RPC_URL: "",
          VITE_SN_MAIN_TORII_URL: "https://placeholder/torii/v1",
          VITE_SN_SEPOLIA_TORII_URL: "https://placeholder/torii/v1",
        }),
      }),
    ],
  };
});
