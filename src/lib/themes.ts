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
  "--red-dim": "rgba(154, 74, 74, 0.15)",
  "--blue": "#4a7a9a",
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
      "--red-dim":       "rgba(255, 51, 102, 0.15)",
      "--blue":          "#00ccff",
    },
  },
  {
    id: "empathy",
    label: "Colorblind Hell (Simulated)",
    // Olive-mud collapsed backgrounds, then everything else near-invisible.
    vars: {
      "--bg-0":          "#0a0a08",
      "--bg-1":          "#0c0b08",
      "--bg-2":          "#131209",
      "--bg-3":          "#191709",
      "--bg-4":          "#201e0c",
      "--border":        "rgba(42, 39, 10, 0.06)",
      "--border-light":  "rgba(56, 53, 15, 0.06)",
      "--text-primary":  "rgba(232, 230, 216, 0.04)",
      "--text-secondary":"rgba(138, 136, 96, 0.04)",
      "--text-muted":    "rgba(78, 76, 48, 0.04)",
      "--accent":        "rgba(106, 104, 64, 0.04)",
      "--accent-bright": "rgba(124, 122, 74, 0.04)",
      "--accent-dim":    "rgba(58, 56, 32, 0.04)",
      "--accent-glow":   "rgba(106, 104, 64, 0.02)",
      "--green":         "rgba(122, 120, 48, 0.04)",
      "--green-dim":     "rgba(122, 120, 48, 0.02)",
      "--red":           "rgba(138, 120, 40, 0.04)",
      "--red-dim":       "rgba(138, 120, 40, 0.02)",
      "--blue":          "rgba(158, 148, 32, 0.04)",
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
      "--red-dim":       "rgba(138, 32, 32, 0.15)",
      "--blue":          "#2a5a8a",
    },
  },
  {
    id: "colorblind-hell",
    label: "Colorblind Hell",
    vars: {
      // Backgrounds: red/green alternating at identical luminance — the thematic core.
      "--bg-0":          "#080d08",
      "--bg-1":          "#0d0808",
      "--bg-2":          "#121b0e",
      "--bg-3":          "#1b120e",
      "--bg-4":          "#212c18",
      // Everything else: near-zero opacity. The app structure exists. Nothing is readable.
      "--border":        "rgba(46, 28, 28, 0.06)",
      "--border-light":  "rgba(62, 44, 42, 0.06)",
      "--text-primary":  "rgba(238, 238, 230, 0.04)",
      "--text-secondary":"rgba(138, 170, 134, 0.04)",
      "--text-muted":    "rgba(80, 112, 72, 0.04)",
      "--accent":        "rgba(22, 163, 74, 0.04)",
      "--accent-bright": "rgba(34, 197, 94, 0.04)",
      "--accent-dim":    "rgba(20, 83, 45, 0.04)",
      "--accent-glow":   "rgba(22, 163, 74, 0.02)",
      "--green":         "rgba(34, 197, 94, 0.04)",
      "--green-dim":     "rgba(34, 197, 94, 0.02)",
      "--red":           "rgba(220, 38, 38, 0.04)",
      "--red-dim":       "rgba(220, 38, 38, 0.02)",
      "--blue":          "rgba(200, 160, 32, 0.04)",
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
