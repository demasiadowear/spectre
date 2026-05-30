import type { Config } from "tailwindcss";

// ============================================================
// SPECTRE theme — "carta/terra" (warm paper). Single source of truth:
// every colour is a CSS variable (RGB channels) defined in globals.css
// for light + dark, so `/opacity` modifiers keep working and the whole
// UI re-themes from one place. Legacy `spectre-*` tokens are kept and
// remapped onto the new semantic vars so existing classes just adopt
// the new palette without per-component edits.
// ============================================================

const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic tokens (preferred going forward).
        bg: v("--c-bg"),
        surface: v("--c-surface"),
        surface2: v("--c-surface2"),
        border: v("--c-border"),
        "border-strong": v("--c-border-strong"),
        text: v("--c-text"),
        text2: v("--c-text2"),
        accent: v("--c-accent"),
        "accent-hover": v("--c-accent-hover"),
        onaccent: v("--c-onaccent"),
        danger: v("--c-danger"),
        success: v("--c-success"),
        ochre: v("--c-amber"),
        scrim: v("--c-scrim"),

        background: v("--c-bg"),
        foreground: v("--c-text"),

        // Legacy SPECTRE tokens → remapped onto the warm palette.
        spectre: {
          ink: v("--c-bg"),
          panel: v("--c-surface"),
          cyan: v("--c-accent"), // primary accent (terracotta)
          magenta: v("--c-danger"), // urgent / lost
          amber: v("--c-amber"), // ochre
          green: v("--c-success"), // salvia (chiuso/vinto)
          text: v("--c-text"),
          muted: v("--c-text2"),
        },
      },
      fontFamily: {
        // No monospace anywhere — calm sans across the board.
        display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-ui)", "ui-sans-serif", "sans-serif"],
        ui: ["var(--font-ui)", "ui-sans-serif", "sans-serif"],
        sans: ["var(--font-ui)", "ui-sans-serif", "sans-serif"],
      },
      borderRadius: {
        sm: "8px", // cards
        md: "12px", // containers
      },
      boxShadow: {
        // Neon → neutralised. Cards get a whisper-soft shadow only.
        "neon-cyan": "none",
        "neon-cyan-lg": "none",
        "neon-magenta": "none",
        "neon-amber": "none",
        "neon-green": "none",
        glass: "0 1px 2px rgb(var(--c-shadow) / 0.06)",
        card: "0 1px 2px rgb(var(--c-shadow) / 0.06)",
      },
      backgroundImage: {
        "hud-grid": "none",
      },
      backgroundSize: {
        grid: "40px 40px",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        blink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2.2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite",
        blink: "blink 1s step-end infinite",
        shimmer: "shimmer 2s linear infinite",
        "fade-up": "fade-up 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
