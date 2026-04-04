export interface ThemeVars {
  [cssVar: string]: string;
}

export interface BuiltInTheme {
  id: string;
  label: string;
  vars: ThemeVars;
}

// CSS variables that define the full palette. A theme only needs to override what it changes.
export const DEFAULT_VARS: ThemeVars = {
  "--bg-0": "#0d0d0e",
  "--bg-1": "#141416",
  "--bg-2": "#1c1c1f",
  "--bg-3": "#242428",
  "--bg-4": "#2e2e33",
  "--border": "#2e2e33",
  "--border-light": "#3a3a40",
  "--text-primary": "#e8e6e1",
  "--text-secondary": "#9e9c97",
  "--text-muted": "#5a5856",
  "--accent": "#d4860a",
  "--accent-bright": "#f0a020",
  "--accent-dim": "#8a5600",
  "--accent-glow": "rgba(212, 134, 10, 0.15)",
  "--green": "#4a9a6a",
  "--green-dim": "rgba(74, 154, 106, 0.15)",
  "--red": "#9a4a4a",
  "--red-bright": "#d47070",
  "--red-dim": "rgba(154, 74, 74, 0.15)",
  "--blue": "#4a7a9a",
  "--blue-dim": "rgba(74, 122, 154, 0.12)",
  "--font-display": "'Syne', sans-serif",
  "--font-mono": "'IBM Plex Mono', monospace",
  "--font-body": "'Newsreader', serif",
};

export const BUILT_IN_THEMES: BuiltInTheme[] = [
  {
    id: "default",
    label: "Default Dark",
    vars: {},  // all defaults
  },
  {
    id: "parchment",
    label: "Dead Tree Edition",
    vars: {
      "--bg-0":          "#f2ede3",
      "--bg-1":          "#e9e2d6",
      "--bg-2":          "#dfd7c8",
      "--bg-3":          "#d4cbb8",
      "--bg-4":          "#c8bea9",
      "--border":        "#b8aa96",
      "--border-light":  "#a49882",
      "--text-primary":  "#2c1f0e",
      "--text-secondary":"#5c4830",
      "--text-muted":    "#8c7458",
      "--accent":        "#8b4513",
      "--accent-bright": "#b05a1a",
      "--accent-dim":    "#c87e40",
      "--accent-glow":   "rgba(139, 69, 19, 0.14)",
      "--green":         "#3a6e2a",
      "--green-dim":     "rgba(58, 110, 42, 0.15)",
      "--red":           "#8b1a1a",
      "--red-bright":    "#c03030",
      "--red-dim":       "rgba(139, 26, 26, 0.15)",
      "--blue":          "#1e3d6e",
    },
  },
  {
    id: "synthwave",
    label: "Synthwave",
    vars: {
      "--bg-0":          "#08000f",
      "--bg-1":          "#0e0018",
      "--bg-2":          "#150022",
      "--bg-3":          "#1e002e",
      "--bg-4":          "#28003c",
      "--border":        "#3a0055",
      "--border-light":  "#520075",
      "--text-primary":  "#f0deff",
      "--text-secondary":"#c090e0",
      "--text-muted":    "#6a4090",
      "--accent":        "#ee0099",
      "--accent-bright": "#ff40c8",
      "--accent-dim":    "#880055",
      "--accent-glow":   "rgba(238, 0, 153, 0.20)",
      "--green":         "#00ffcc",
      "--green-dim":     "rgba(0, 255, 204, 0.15)",
      "--red":           "#ff3366",
      "--red-bright":    "#ff6699",
      "--red-dim":       "rgba(255, 51, 102, 0.15)",
      "--blue":          "#00ccff",
    },
  },
  {
    id: "empathy",
    label: "Colorblind Hell (Simulated)",
    // A deuteranopia simulation of the Colorblind Hell theme — fully opaque, fully readable.
    // The colours themselves carry the confusion. The vivid red/green panels from Hell both
    // collapse to the same indistinguishable olive-dark. The accent, approve-green, and
    // reject-red all resolve to near-identical olive-gold — 2–4 units apart in hex.
    // You can read everything. You can't use any of the colour signals.
    // Blue is the only hue deuteranopia preserves — which is why that escape button glows.
    vars: {
      // Red and green panels from Hell, collapsed to identical olive-dark
      "--bg-0":          "#0b0b04",
      "--bg-1":          "#0c0c04",
      "--bg-2":          "#121104",
      "--bg-3":          "#131204",
      "--bg-4":          "#1a1806",
      "--border":        "#272300",
      "--border-light":  "#282400",
      // Text: cream, fully opaque, readable — the hell is not about visibility
      "--text-primary":  "#e0ddb8",
      "--text-secondary":"#989060",
      "--text-muted":    "#585030",
      // Red-orange accent as seen through deuteranopia → golden-olive
      "--accent":        "#c28800",
      "--accent-bright": "#dea000",
      "--accent-dim":    "#7c5800",
      "--accent-glow":   "rgba(194, 136, 0, 0.18)",
      // Pure green → olive-yellow. Pure red → golden-olive.
      // #9ea200 vs #9c9e00. Good luck telling those apart.
      "--green":         "#9ea200",
      "--green-dim":     "rgba(158, 162, 0, 0.15)",
      "--red":           "#9c9e00",
      "--red-bright":    "#c4c600",
      "--red-dim":       "rgba(156, 158, 0, 0.15)",
      // Blue: preserved through deuteranopia — the one colour that still means something
      "--blue":          "#4428c8",
    },
  },
  {
    id: "light",
    label: "Light Mode, I Guess",
    vars: {
      "--bg-0":          "#f5f4f0",
      "--bg-1":          "#edeae4",
      "--bg-2":          "#e4e0d8",
      "--bg-3":          "#d8d3ca",
      "--bg-4":          "#ccc7bd",
      "--border":        "#bfb9b0",
      "--border-light":  "#a8a298",
      "--text-primary":  "#1a1917",
      "--text-secondary":"#4a4845",
      "--text-muted":    "#8a8480",
      // Amber needs to be darker to maintain contrast on a light background
      "--accent":        "#a06008",
      "--accent-bright": "#b87010",
      "--accent-dim":    "#d49030",
      "--accent-glow":   "rgba(160, 96, 8, 0.12)",
      "--green":         "#2d7a4a",
      "--green-dim":     "rgba(45, 122, 74, 0.15)",
      "--red":           "#8a2020",
      "--red-bright":    "#c04040",
      "--red-dim":       "rgba(138, 32, 32, 0.15)",
      "--blue":          "#2a5a8a",
    },
  },
  {
    id: "colorblind-hell",
    label: "Colorblind Hell",
    // A garish red/green nightmare. Text is fully readable — the suffering comes from
    // the colour chaos. Backgrounds alternate vivid red/green tints. The accent is pure
    // saturated red, so every active/selected state looks like an error or rejection.
    // Sighted users: eye strain and existential dread. Colourblind users: complete chaos.
    vars: {
      // Backgrounds: vivid alternating red/green tints — clashing panels
      "--bg-0":          "#0e0606",
      "--bg-1":          "#060e06",
      "--bg-2":          "#1c0a0a",
      "--bg-3":          "#0a1c0a",
      "--bg-4":          "#260e0e",
      "--border":        "#4a0000",
      "--border-light":  "#004a00",
      // Accent: max-saturated red — nav highlights, active states, EZ glow all look like errors
      "--accent":        "#ff1100",
      "--accent-bright": "#ff3300",
      "--accent-dim":    "#cc0000",
      "--accent-glow":   "rgba(255, 17, 0, 0.30)",
      // Max-saturated green and red. Sighted: obviously different, deeply unpleasant together.
      // Colourblind: identical. Either way, unpleasant.
      "--green":         "#00ff44",
      "--green-dim":     "rgba(0, 255, 68, 0.20)",
      "--red":           "#ff0000",
      "--red-bright":    "#ff4444",
      "--red-dim":       "rgba(255, 0, 0, 0.20)",
      // Purple, because why not
      "--blue":          "#cc00ff",
    },
  },
  {
    id: "yelluuuu",
    label: "yelluuuu ~~~ <3",
    vars: {
      "--bg-0":          "#0e0d00",
      "--bg-1":          "#181500",
      "--bg-2":          "#221e00",
      "--bg-3":          "#2c2800",
      "--bg-4":          "#363100",
      "--border":        "#4a4200",
      "--border-light":  "#5e5400",
      "--text-primary":  "#fff8d0",
      "--text-secondary":"#d4c84a",
      "--text-muted":    "#7a6e20",
      "--accent":        "#e8c800",
      "--accent-bright": "#ffe040",
      "--accent-dim":    "#9a8400",
      "--accent-glow":   "rgba(232, 200, 0, 0.18)",
      "--green":         "#b8d800",
      "--green-dim":     "rgba(184, 216, 0, 0.15)",
      "--red":           "#d47020",
      "--red-bright":    "#e89040",
      "--red-dim":       "rgba(212, 112, 32, 0.15)",
      "--blue":          "#60a0d8",
    },
  },
  {
    id: "colorblind",
    label: "Colorblind Friendly",
    vars: {
      // Accent: amber → blue (safe across deuteranopia, protanopia, tritanopia)
      "--accent":       "#5b8ef0",
      "--accent-bright":"#7aa4f8",
      "--accent-dim":   "#2a5ab8",
      "--accent-glow":  "rgba(91, 142, 240, 0.15)",
      // Status: green/red → teal/orange (Okabe-Ito safe pair)
      "--green":        "#2aaa88",
      "--green-dim":    "rgba(42, 170, 136, 0.15)",
      "--red":          "#e07830",
      "--red-bright":   "#f09850",
      "--red-dim":      "rgba(224, 120, 48, 0.15)",
      // Blue accent used in log coloring — shift to violet to stay distinct
      "--blue":         "#8888e0",
    },
  },
];

/** Apply a merged set of CSS variables to :root. */
export function applyTheme(overrides: ThemeVars) {
  const merged = { ...DEFAULT_VARS, ...overrides };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(merged)) {
    root.style.setProperty(k, v);
  }
}

/** Reset :root to defaults (removes any inline overrides). */
export function resetTheme() {
  const root = document.documentElement;
  for (const k of Object.keys(DEFAULT_VARS)) {
    root.style.removeProperty(k);
  }
}
