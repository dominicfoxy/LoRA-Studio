import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import {
  User, List, Image, AlignLeft, Server, Settings, ChevronRight
} from "lucide-react";
import CharacterSetup from "./pages/CharacterSetup";
import ShotList from "./pages/ShotList";
import BatchGenerator from "./pages/BatchGenerator";
import CaptionEditor from "./pages/CaptionEditor";
import RunPodLauncher from "./pages/RunPodLauncher";
import SettingsPage from "./pages/SettingsPage";
import { useStore } from "./store";

const NAV_ITEMS = [
  { to: "/", icon: User, label: "Character", sub: "identity & trigger" },
  { to: "/shots", icon: List, label: "Shot List", sub: "poses & outfits" },
  { to: "/generate", icon: Image, label: "Generate", sub: "forge batch" },
  { to: "/captions", icon: AlignLeft, label: "Captions", sub: "review & edit" },
  { to: "/runpod", icon: Server, label: "RunPod", sub: "train on cloud" },
  { to: "/settings", icon: Settings, label: "Settings", sub: "endpoints & keys" },
];

export default function App() {
  const location = useLocation();
  const character = useStore((s) => s.character);
  const images = useStore((s) => s.images);
  const approved = images.filter((i) => i.approved === true).length;

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
            LoRA<span style={{ color: "var(--text-muted)" }}>·</span>Studio
          </div>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "var(--text-muted)",
            marginTop: "2px",
            letterSpacing: "0.08em",
          }}>
            CHARACTER TRAINER
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
                  background: active ? "var(--bg-3)" : "transparent",
                  borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                  transition: "all 0.12s",
                }}
              >
                <Icon
                  size={15}
                  color={active ? "var(--accent-bright)" : "var(--text-muted)"}
                  strokeWidth={active ? 2.5 : 1.5}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "13px",
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    letterSpacing: "0.01em",
                  }}>{label}</div>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    color: "var(--text-muted)",
                    letterSpacing: "0.06em",
                  }}>{sub}</div>
                </div>
                {active && <ChevronRight size={11} color="var(--accent-dim)" />}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: "9px",
          color: "var(--text-muted)",
          letterSpacing: "0.06em",
        }}>
          SDXL · ILLUSTRIOUS · KOHYA
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Routes>
          <Route path="/" element={<CharacterSetup />} />
          <Route path="/shots" element={<ShotList />} />
          <Route path="/generate" element={<BatchGenerator />} />
          <Route path="/captions" element={<CaptionEditor />} />
          <Route path="/runpod" element={<RunPodLauncher />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
