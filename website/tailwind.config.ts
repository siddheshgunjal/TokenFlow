import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "#070B14",
        panel: "#0D1420",
        "panel-strong": "#16202F",
        ink: "#E8EDF4",
        muted: "#8C9AAE",
        accent: "#00D4C0",
        "accent-strong": "#00A896",
        "accent-hover": "#2BE3D3",
        "accent-blue": "#2F6BFF",
        success: "#22C55E",
        warning: "#F5A623",
        danger: "#EF4444",
        "data-cyan": "#4DE8D8",
        "data-amber": "#FBBF24",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      gridTemplateRows: {
        7: "repeat(7, minmax(0, 1fr))",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 16px 40px -24px rgba(0,0,0,0.8)",
        glow: "0 0 0 1px rgba(0,212,192,0.18), 0 12px 40px -12px rgba(0,212,192,0.25)",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "fade-up": "fade-up 0.35s ease-out both",
      },
    },
    plugins: [],
  } satisfies Config,
} satisfies Config;
