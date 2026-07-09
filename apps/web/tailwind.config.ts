import type { Config } from "tailwindcss";

/**
 * Quiet, operational theme. Layout and text lean on neutral grays; a single
 * restrained accent is reserved for primary actions and active navigation so
 * the surface stays focused on redemption status and agent comparison rather
 * than decoration.
 */
const config: Config = {
  darkMode: "media",
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#0f766e",
          foreground: "#ffffff",
          muted: "#5eead4",
        },
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
