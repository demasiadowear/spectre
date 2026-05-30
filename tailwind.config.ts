import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        spectre: {
          ink: "#050505",
          panel: "#0a0a0f",
          cyan: "#00f0ff",
          magenta: "#ff006e",
          amber: "#ffbe0b",
          green: "#38b000",
          text: "#e0e0e0",
          muted: "rgba(224, 224, 224, 0.6)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        ui: ["var(--font-ui)", "ui-sans-serif", "sans-serif"],
        sans: ["var(--font-ui)", "ui-sans-serif", "sans-serif"],
      },
      borderRadius: {
        sm: "2px",
        md: "4px",
      },
      boxShadow: {
        "neon-cyan": "0 0 20px rgba(0, 240, 255, 0.3)",
        "neon-cyan-lg": "0 0 40px rgba(0, 240, 255, 0.45)",
        "neon-magenta": "0 0 20px rgba(255, 0, 110, 0.35)",
        "neon-amber": "0 0 20px rgba(255, 190, 11, 0.3)",
        "neon-green": "0 0 20px rgba(56, 176, 0, 0.3)",
        glass:
          "inset 0 1px 0 0 rgba(255, 255, 255, 0.04), 0 8px 32px rgba(0, 0, 0, 0.45)",
      },
      backgroundImage: {
        "hud-grid":
          "linear-gradient(rgba(0,240,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.06) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "40px 40px",
      },
      keyframes: {
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        "grid-pulse": {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "0.6" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        flicker: {
          "0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%": { opacity: "1" },
          "20%, 24%, 55%": { opacity: "0.4" },
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
        scan: "scan 7s linear infinite",
        "grid-pulse": "grid-pulse 6s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2.2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite",
        flicker: "flicker 4s linear infinite",
        blink: "blink 1s step-end infinite",
        shimmer: "shimmer 2s linear infinite",
        "fade-up": "fade-up 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
