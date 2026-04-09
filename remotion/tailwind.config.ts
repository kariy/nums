import type { Config } from "tailwindcss";
import { preset } from "../client/src/themes/preset";

const config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "../client/src/components/**/*.{ts,tsx}",
    "../client/src/lib/**/*.{ts,tsx}",
  ],
  presets: [preset],
  theme: {
    screens: {
      sm: "9999px",
      md: "9999px",
      lg: "9999px",
      xl: "9999px",
      "2xl": "9999px",
    },
    extend: {
      width: {
        desktop: "432px",
      },
      height: {
        desktop: "600px",
      },
      borderRadius: {
        "2xl": "16px",
        "3xl": "24px",
        "4xl": "32px",
      },
      keyframes: {
        "pulse-border": {
          "0%": {
            outline: "1px solid currentColor",
            outlineOffset: "1px",
            opacity: "0",
          },
          "50%": {
            outline: "1px solid currentColor",
            outlineOffset: "1px",
            opacity: "0.32",
          },
          "100%": {
            outline: "1px solid currentColor",
            outlineOffset: "6px",
            opacity: "0",
          },
        },
      },
      animation: {
        "pulse-border-0": "pulse-border 3s ease-out infinite 0s backwards",
        "pulse-border-1": "pulse-border 3s ease-out infinite 1s backwards",
        "pulse-border-2": "pulse-border 3s ease-out infinite 2s backwards",
        spin: "spin 0.5s linear infinite",
      },
    },
  },
} satisfies Config;

export default config;
