import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  User, List, Image, AlignLeft, Server, Settings, ChevronRight, SlidersHorizontal
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BUILT_IN_THEMES, applyTheme, resetTheme } from "./lib/themes";
import CharacterSetup from "./pages/CharacterSetup";
import ShotList from "./pages/ShotList";
import GeneratorSettings from "./pages/GeneratorSettings";
import BatchGenerator from "./pages/BatchGenerator";
import CaptionEditor from "./pages/CaptionEditor";
import RunPodLauncher from "./pages/RunPodLauncher";
import SettingsPage from "./pages/SettingsPage";
import { useStore } from "./store";

const NAV_ITEMS = [
  { to: "/", icon: User, label: "Character", sub: "identity & trigger" },
  { to: "/shots", icon: List, label: "Shot List", sub: "poses & outfits" },
  { to: "/generator", icon: SlidersHorizontal, label: "Sampler", sub: "steps, cfg, scheduler" },
  { to: "/generate", icon: Image, label: "Generate", sub: "forge batch" },
  { to: "/captions", icon: AlignLeft, label: "Captions", sub: "review & edit" },
  { to: "/runpod", icon: Server, label: "RunPod", sub: "train on cloud" },
  { to: "/settings", icon: Settings, label: "Settings", sub: "endpoints & keys" },
];

export default function App() {
  const location = useLocation();
  const character = useStore((s) => s.character);
  const images = useStore((s) => s.images);
  const isDirty = useStore((s) => s.isDirty);
  const markSaved = useStore((s) => s.markSaved);
  const uiScale = useStore((s) => s.settings.uiScale ?? 1.0);
  const activeTheme = useStore((s) => s.settings.activeTheme ?? "default");
  const themeFile = useStore((s) => s.settings.themeFile ?? "");
  const ezMode = useStore((s) => s.settings.ezMode ?? false);
  const setSettings = useStore((s) => s.setSettings);
  const approved = images.filter((i) => i.approved === true).length;
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [saveCloseError, setSaveCloseError] = useState<string | null>(null);
  const [savingClose, setSavingClose] = useState(false);

  useEffect(() => {
    document.documentElement.style.zoom = String(uiScale);
  }, [uiScale]);

  useEffect(() => {
    const builtIn = BUILT_IN_THEMES.find((t) => t.id === activeTheme);
    const baseVars = builtIn?.vars ?? {};

    if (themeFile) {
      invoke<string>("load_project", { path: themeFile })
        .then((raw) => {
          try {
            const fileVars = JSON.parse(raw);
            applyTheme({ ...baseVars, ...fileVars });
          } catch {
            applyTheme(baseVars);
          }
        })
        .catch(() => applyTheme(baseVars));
    } else if (Object.keys(baseVars).length > 0) {
      applyTheme(baseVars);
    } else {
      resetTheme();
    }
  }, [activeTheme, themeFile]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("close-requested-check", async () => {
      if (useStore.getState().isDirty) {
        setShowCloseDialog(true);
      } else {
        await invoke("close_app");
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const saveAndClose = async () => {
    if (savingClose) return;
    setSavingClose(true);
    setSaveCloseError(null);
    const { character: c, generation, settings, images: imgs } = useStore.getState();
    if (c.outputDir) {
      try {
        await invoke("ensure_dir", { path: c.outputDir });
        await invoke("save_project", {
          path: `${c.outputDir}/project.json`,
          data: JSON.stringify({ character: c, generation, settings, images: imgs }, null, 2),
        });
        markSaved();
      } catch (e) {
        setSaveCloseError(`Save failed: ${e}`);
        setSavingClose(false);
        return;
      }
    }
    await invoke("close_app");
  };

  const discardAndClose = async () => {
    markSaved();
    await invoke("close_app");
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-0)" }}>
      {/* Sidebar */}
      <aside style={{
        width: "var(--sidebar-width)",
        background: "var(--bg-1)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{
          padding: "20px 16px 16px",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: "18px",
            fontWeight: 800,
            color: "var(--accent-bright)",
            letterSpacing: "-0.02em",
          }}>
            Casting<br />Couch
          </div>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "var(--text-muted)",
            marginTop: "2px",
            letterSpacing: "0.08em",
          }}>
            LoRA Studio
          </div>
        </div>

        {/* Character pill */}
        {character.name && (
          <div style={{
            margin: "12px 12px 0",
            padding: "8px 10px",
            background: "var(--accent-glow)",
            border: "1px solid var(--accent-dim)",
            borderRadius: "6px",
          }}>
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}>Active Character</div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--accent-bright)",
              marginTop: "2px",
            }}>{character.name}</div>
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-muted)",
              marginTop: "1px",
            }}>{approved} approved / {images.length} total</div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV_ITEMS.map(({ to, icon: Icon, label, sub }) => {
            const active = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
            // Settings link: hardcoded colours that bypass CSS vars entirely so it's always
            // findable regardless of how broken the active theme is.
            const isSafeLink = to === "/settings";
            const SAFE_BG     = "rgba(29, 78, 216, 0.20)";
            const SAFE_BORDER  = "#3b82f6";
            const SAFE_TEXT    = "#93c5fd";
            const SAFE_MUTED   = "#6ea8f7";
            return (
              <NavLink
                key={to}
                to={to}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  textDecoration: "none",
                  background: isSafeLink ? SAFE_BG : active ? "var(--bg-3)" : "transparent",
                  borderLeft: isSafeLink ? `2px solid ${SAFE_BORDER}` : active ? "2px solid var(--accent)" : "2px solid transparent",
                  transition: "all 0.12s",
                }}
              >
                <Icon
                  size={15}
                  color={isSafeLink ? SAFE_BORDER : active ? "var(--accent-bright)" : "var(--text-muted)"}
                  strokeWidth={active ? 2.5 : 1.5}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "13px",
                    fontWeight: active ? 700 : 500,
                    color: isSafeLink ? SAFE_TEXT : active ? "var(--text-primary)" : "var(--text-secondary)",
                    letterSpacing: "0.01em",
                  }}>{label}</div>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: isSafeLink ? SAFE_MUTED : "var(--text-muted)",
                    letterSpacing: "0.04em",
                  }}>{sub}</div>
                </div>
                {active && <ChevronRight size={11} color="var(--accent-dim)" />}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{
          padding: "10px 16px 12px",
          borderTop: `1px solid ${ezMode ? "var(--accent-dim)" : "var(--border)"}`,
          background: ezMode ? "var(--accent-glow)" : "transparent",
          transition: "background 0.3s, border-color 0.3s",
        }}>
          <button
            onClick={() => setSettings({ ezMode: !ezMode })}
            style={{
              width: "100%",
              padding: "5px 8px",
              marginBottom: "8px",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "10px",
              letterSpacing: "0.1em",
              borderRadius: "5px",
              border: `1px solid ${ezMode ? "var(--accent-bright)" : "var(--border)"}`,
              background: ezMode ? "var(--accent-glow)" : "var(--bg-2)",
              color: ezMode ? "var(--accent-bright)" : "var(--text-muted)",
              boxShadow: ezMode ? "0 0 10px var(--accent-dim), inset 0 0 8px var(--accent-glow)" : "none",
              transition: "all 0.2s",
            }}
          >
            {ezMode ? "⚡ EZ MODE ON" : "EZ MODE"}
          </button>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            color: ezMode ? "var(--accent-dim)" : "var(--text-muted)",
            letterSpacing: "0.06em",
            transition: "color 0.3s",
          }}>
            SDXL · ILLUSTRIOUS · KOHYA
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Routes>
          <Route path="/" element={<CharacterSetup />} />
          <Route path="/shots" element={<ShotList />} />
          <Route path="/generator" element={<GeneratorSettings />} />
          <Route path="/generate" element={<BatchGenerator />} />
          <Route path="/captions" element={<CaptionEditor />} />
          <Route path="/runpod" element={<RunPodLauncher />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* Unsaved changes dialog */}
      {showCloseDialog && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "28px 32px",
            maxWidth: "380px",
            width: "100%",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "16px", fontWeight: 800, color: "var(--text-primary)", marginBottom: "8px" }}>
              Unsaved Changes
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-secondary)", marginBottom: saveCloseError ? "12px" : "24px", lineHeight: 1.5 }}>
              {character.outputDir
                ? "You have unsaved changes. Save before closing?"
                : "You have unsaved changes but no output directory is set — they cannot be saved."}
            </div>
            {saveCloseError && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--red, #d47070)", marginBottom: "16px", lineHeight: 1.5 }}>
                {saveCloseError}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowCloseDialog(false)}
                style={{ padding: "7px 16px", fontSize: "12px", cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "5px", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em" }}
              >
                Cancel
              </button>
              <button
                onClick={discardAndClose}
                disabled={savingClose}
                style={{ padding: "7px 16px", fontSize: "12px", cursor: savingClose ? "default" : "pointer", background: "transparent", border: "1px solid var(--red)", color: "var(--red)", borderRadius: "5px", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em", opacity: savingClose ? 0.4 : 1 }}
              >
                Discard &amp; Close
              </button>
              {character.outputDir && (
                <button
                  onClick={saveAndClose}
                  disabled={savingClose}
                  style={{ padding: "7px 16px", fontSize: "12px", cursor: savingClose ? "default" : "pointer", background: "var(--accent)", border: "none", color: "white", borderRadius: "5px", fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.05em", opacity: savingClose ? 0.7 : 1 }}
                >
                  {savingClose ? "Saving…" : "Save & Close"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
