import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, ChevronDown, ChevronUp, Layers } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore, OutfitEntry, PoseEntry } from "../store";
import { normSeg, buildDynamicPromptsBlock } from "../lib/forge";

const POSE_PRESETS = [
  "standing, full body", "sitting", "kneeling", "lying down", "crouching",
  "arms crossed", "hands on hips", "one hand raised", "arms behind back",
  "leaning against wall", "walking", "running", "looking over shoulder",
  "from behind", "from above", "upper body", "portrait, close-up", "cowboy shot",
];
const EXPRESSION_PRESETS = [
  "neutral expression", "smiling, looking at viewer", "grinning", "laughing",
  "serious expression", "stern expression", "frowning",
  "surprised expression", "shocked expression", "blushing",
  "sleepy expression, tired", "confident expression",
  "shy expression", "winking", "eyes closed",
  "angry, glaring", "sad expression", "looking away",
];
const BACKGROUND_PRESETS = [
  "simple background, white background", "simple background, grey background",
  "simple background, gradient background", "outdoors, forest background",
  "outdoors, city background, night", "outdoors, beach background",
  "indoors, bedroom background", "indoors, cafe background",
  "indoors, office background", "studio background", "bokeh background",
];
const OUTFIT_PRESETS = [
  "casual outfit, jeans, t-shirt", "business casual, dress shirt, slacks",
  "formal outfit, suit", "sundress", "hoodie, sweatpants",
  "crop top, shorts", "swimsuit", "sportswear, athletic wear",
  "fantasy armor", "school uniform", "lab coat", "nude",
];

const SIZE_PRESETS = [
  { label: "1:1", w: 1024, h: 1024 },
  { label: "4:3", w: 1152, h: 896 },
  { label: "3:4", w: 896, h: 1152 },
  { label: "16:9", w: 1216, h: 704 },
  { label: "9:16", w: 704, h: 1216 },
  { label: "2:3", w: 832, h: 1216 },
  { label: "3:2", w: 1216, h: 832 },
];

// ── Category Panel ─────────────────────────────────────────────────────────────
function CategoryPanel({
  label,
  values,
  onChange,
  presets,
  placeholder,
  accentColor = "var(--accent)",
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  presets: string[];
  placeholder: string;
  accentColor?: string;
}) {
  const [showPresets, setShowPresets] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const update = (i: number, v: string) => {
    const next = [...values];
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const addPreset = (p: string) => {
    if (!values.includes(p)) onChange([...values, p]);
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "12px", overflow: "hidden" }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: "flex", alignItems: "center", gap: "10px",
          padding: "10px 16px", cursor: "pointer", background: "var(--bg-3)",
          userSelect: "none",
        }}
      >
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: "10px",
          color: accentColor, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700,
        }}>{label}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
          {values.length} variant{values.length !== 1 ? "s" : ""}
        </div>
        <div style={{ flex: 1 }} />
        {collapsed
          ? <ChevronDown size={13} color="var(--text-muted)" />
          : <ChevronUp size={13} color="var(--text-muted)" />}
      </div>

      {!collapsed && (
        <div style={{ padding: "12px 16px" }}>
          {values.map((v, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: "10px",
                color: "var(--text-muted)", width: "18px", textAlign: "right", flexShrink: 0,
              }}>{i + 1}</div>
              <input
                style={{ flex: 1 }}
                value={v}
                placeholder={placeholder}
                onChange={(e) => update(i, e.target.value)}
              />
              <button
                onClick={() => remove(i)}
                className="btn-ghost"
                style={{ padding: "4px 8px", fontSize: "14px", flexShrink: 0, color: "var(--text-muted)", lineHeight: 1 }}
              >×</button>
            </div>
          ))}

          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button
              className="btn-ghost"
              onClick={() => onChange([...values, ""])}
              style={{ padding: "5px 12px", fontSize: "10px" }}
            >
              <Plus size={10} style={{ display: "inline", marginRight: "4px" }} />Add
            </button>
            <button
              className="btn-ghost"
              onClick={() => setShowPresets(!showPresets)}
              style={{
                padding: "5px 12px", fontSize: "10px",
                background: showPresets ? "var(--accent-glow)" : undefined,
                border: showPresets ? "1px solid var(--accent-dim)" : undefined,
                color: showPresets ? "var(--accent-bright)" : undefined,
              }}
            >
              Presets {showPresets ? "▲" : "▼"}
            </button>
          </div>

          {showPresets && (
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "8px" }}>
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => addPreset(p)}
                  style={{
                    padding: "3px 9px", fontSize: "10px", fontFamily: "var(--font-mono)",
                    background: values.includes(p) ? "var(--accent-glow)" : "var(--bg-3)",
                    border: `1px solid ${values.includes(p) ? "var(--accent-dim)" : "var(--border)"}`,
                    color: values.includes(p) ? "var(--accent-bright)" : "var(--text-muted)",
                    borderRadius: "3px", cursor: values.includes(p) ? "default" : "pointer",
                    letterSpacing: 0, textTransform: "none", fontWeight: 400,
                  }}
                >
                  {p.length > 36 ? p.slice(0, 36) + "…" : p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline LoRA Adder ─────────────────────────────────────────────────────────
function InlineLoraAdder({ attached, loraFiles, onAdd, onRemove }: {
  attached: string[];
  loraFiles: { name: string; path: string; dir: string }[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});

  const getWeight = (name: string) => weights[name] ?? 0.8;
  const attachedNames = new Set(attached.map((t) => t.replace(/<lora:([^:>]+):[^>]+>/, "$1")));
  const filtered = loraFiles.filter((l) =>
    (l.name.toLowerCase().includes(filter.toLowerCase()) || l.dir.toLowerCase().includes(filter.toLowerCase()))
    && !attachedNames.has(l.name)
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center", paddingLeft: "26px", marginTop: "4px" }}>
      {attached.map((tag) => {
        const name = tag.replace(/<lora:([^:>]+):[^>]+>/, "$1");
        return (
          <div key={tag} style={{
            display: "inline-flex", alignItems: "center", gap: "3px",
            padding: "2px 6px 2px 8px", borderRadius: "3px",
            background: "var(--accent-glow)", border: "1px solid var(--accent-dim)",
            fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--accent-bright)",
          }}>
            {name}
            <button onClick={() => onRemove(tag)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent-bright)", padding: "0 0 0 2px", fontSize: "13px", lineHeight: 1, display: "flex", alignItems: "center" }}>×</button>
          </div>
        );
      })}
      <div style={{ position: "relative" }}>
        <button
          className="btn-ghost"
          onClick={() => setOpen(!open)}
          style={{ padding: "2px 8px", fontSize: "10px", color: "var(--text-muted)" }}
        >＋ lora</button>
        {open && (
          <div style={{
            position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: "4px",
            background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "6px",
            padding: "8px", width: "280px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}>
            <input
              autoFocus
              style={{ width: "100%", fontSize: "11px", marginBottom: "6px" }}
              placeholder="filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div style={{ maxHeight: "200px", overflowY: "auto" }}>
              {filtered.length === 0
                ? <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", padding: "4px" }}>No LoRAs found</div>
                : filtered.map((lora) => (
                  <div key={lora.path} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 2px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lora.dir ? `${lora.dir}/${lora.name}` : lora.name}>
                      {lora.dir ? <span style={{ color: "var(--text-muted)" }}>{lora.dir}/</span> : null}{lora.name}
                    </div>
                    <input
                      type="number" min={0.1} max={2.0} step={0.1}
                      value={getWeight(lora.name)}
                      onChange={(e) => setWeights((w) => ({ ...w, [lora.name]: parseFloat(e.target.value) || 0.8 }))}
                      style={{ width: "44px", padding: "2px 3px", fontSize: "10px", textAlign: "center" }}
                    />
                    <button
                      onClick={() => { onAdd(`<lora:${lora.name}:${getWeight(lora.name)}>`); setOpen(false); setFilter(""); }}
                      style={{ padding: "2px 7px", fontSize: "10px", background: "var(--accent-glow)", border: "1px solid var(--accent-dim)", color: "var(--accent-bright)", borderRadius: "3px", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0 }}
                    >Add</button>
                  </div>
                ))
              }
            </div>
            <button onClick={() => setOpen(false)} style={{ marginTop: "6px", width: "100%", padding: "3px", fontSize: "10px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "3px", cursor: "pointer" }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Outfit Category Panel ──────────────────────────────────────────────────────
function OutfitCategoryPanel({
  values,
  onChange,
  presets,
  loraFiles,
}: {
  values: OutfitEntry[];
  onChange: (v: OutfitEntry[]) => void;
  presets: string[];
  loraFiles: { name: string; path: string; dir: string }[];
}) {
  const [showPresets, setShowPresets] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const update = (i: number, patch: Partial<OutfitEntry>) => {
    const next = [...values];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const addPreset = (p: string) => {
    if (!values.some((v) => v.prompt === p)) onChange([...values, { prompt: p }]);
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "12px", overflow: "hidden" }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", cursor: "pointer", background: "var(--bg-3)", userSelect: "none" }}
      >
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "#a0c878", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
          Outfits / Clothing
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>
          {values.length} variant{values.length !== 1 ? "s" : ""}
        </div>
        <div style={{ flex: 1 }} />
        {collapsed ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronUp size={13} color="var(--text-muted)" />}
      </div>

      {!collapsed && (
        <div style={{ padding: "12px 16px" }}>
          {values.map((v, i) => (
            <div key={i} style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", width: "18px", textAlign: "right", flexShrink: 0 }}>{i + 1}</div>
                <input
                  style={{ flex: 1 }}
                  value={v.prompt}
                  placeholder="e.g. casual outfit, jeans, a plain white t-shirt"
                  onChange={(e) => update(i, { prompt: e.target.value })}
                />
                <button
                  onClick={() => remove(i)}
                  className="btn-ghost"
                  style={{ padding: "4px 8px", fontSize: "14px", flexShrink: 0, color: "var(--text-muted)", lineHeight: 1 }}
                >×</button>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px", paddingLeft: "26px" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", flexShrink: 0, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Trigger
                </div>
                <input
                  style={{ width: "180px", fontSize: "11px" }}
                  value={v.triggerWord ?? ""}
                  placeholder="optional secondary trigger word"
                  onChange={(e) => update(i, { triggerWord: e.target.value || undefined })}
                />
              </div>
              {loraFiles.length > 0 && (
                <InlineLoraAdder
                  attached={v.loras ?? []}
                  loraFiles={loraFiles}
                  onAdd={(tag) => update(i, { loras: [...(v.loras ?? []), tag] })}
                  onRemove={(tag) => update(i, { loras: (v.loras ?? []).filter((l) => l !== tag) })}
                />
              )}
            </div>
          ))}

          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button className="btn-ghost" onClick={() => onChange([...values, { prompt: "" }])} style={{ padding: "5px 12px", fontSize: "10px" }}>
              <Plus size={10} style={{ display: "inline", marginRight: "4px" }} />Add
            </button>
            <button
              className="btn-ghost"
              onClick={() => setShowPresets(!showPresets)}
              style={{
                padding: "5px 12px", fontSize: "10px",
                background: showPresets ? "var(--accent-glow)" : undefined,
                border: showPresets ? "1px solid var(--accent-dim)" : undefined,
                color: showPresets ? "var(--accent-bright)" : undefined,
              }}
            >
              Presets {showPresets ? "▲" : "▼"}
            </button>
          </div>

          {showPresets && (
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "8px" }}>
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => addPreset(p)}
                  style={{
                    padding: "3px 9px", fontSize: "10px", fontFamily: "var(--font-mono)",
                    background: values.some((v) => v.prompt === p) ? "var(--accent-glow)" : "var(--bg-3)",
                    border: `1px solid ${values.some((v) => v.prompt === p) ? "var(--accent-dim)" : "var(--border)"}`,
                    color: values.some((v) => v.prompt === p) ? "var(--accent-bright)" : "var(--text-muted)",
                    borderRadius: "3px", cursor: values.some((v) => v.prompt === p) ? "default" : "pointer",
                    letterSpacing: 0, textTransform: "none", fontWeight: 400,
                  }}
                >
                  {p.length > 36 ? p.slice(0, 36) + "…" : p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Chip Input (compact, for embeddings) ─────────────────────────────────────
function ChipInput({ values, onChange, placeholder }: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  const add = (tag: string) => {
    const t = tag.trim();
    if (!t || values.includes(t)) return;
    onChange([...values, t]);
  };
  const commit = () => { if (input.trim()) { add(input); setInput(""); } };
  return (
    <div>
      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
          {values.map((v) => (
            <div key={v} style={{
              display: "inline-flex", alignItems: "center", gap: "3px",
              padding: "2px 6px 2px 9px",
              background: "var(--bg-3)", border: "1px solid var(--border)",
              borderRadius: "3px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)",
            }}>
              {v}
              <button onClick={() => onChange(values.filter((x) => x !== v))} style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--text-muted)", padding: "0 0 0 2px", fontSize: "13px", lineHeight: 1,
                display: "flex", alignItems: "center",
              }}>×</button>
            </div>
          ))}
        </div>
      )}
      <input
        style={{ width: "100%" }}
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } }}
        onBlur={commit}
      />
    </div>
  );
}

// ── LoRA Browser ──────────────────────────────────────────────────────────────
interface LoraFile { name: string; path: string; dir: string; }

function LoraBrowser({ onInsert }: { onInsert: (tag: string) => void }) {
  const { character } = useStore();
  const [loras, setLoras] = useState<LoraFile[]>([]);
  const [filter, setFilter] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const scanLoras = async () => {
    if (!character.loraDir) return;
    try {
      const files = await invoke<string[]>("list_lora_files", { dir: character.loraDir });
      const base = character.loraDir.replace(/\\/g, "/").replace(/\/$/, "");
      setLoras(files.map((p) => {
        const norm = p.replace(/\\/g, "/");
        const rel = norm.startsWith(base + "/") ? norm.slice(base.length + 1) : norm;
        const parts = rel.split("/");
        const filename = parts.pop()!;
        const name = filename.replace(/\.(safetensors|pt|ckpt)$/i, "");
        const dir = parts.join("/");
        return { name, path: norm, dir };
      }));
      setLoaded(true);
    } catch (e) {
      console.error("LoRA scan failed:", e);
    }
  };

  useEffect(() => { if (character.loraDir) scanLoras(); }, [character.loraDir]);

  const toggleDir = (dir: string) =>
    setCollapsedDirs((s) => { const n = new Set(s); n.has(dir) ? n.delete(dir) : n.add(dir); return n; });

  const getWeight = (name: string) => weights[name] ?? 0.8;

  const filtered = loras.filter((l) =>
    l.name.toLowerCase().includes(filter.toLowerCase()) ||
    l.dir.toLowerCase().includes(filter.toLowerCase())
  );

  // Group by directory
  const groups: [string, LoraFile[]][] = [];
  for (const lora of filtered) {
    const last = groups[groups.length - 1];
    if (last && last[0] === lora.dir) last[1].push(lora);
    else groups.push([lora.dir, [lora]]);
  }

  if (!character.loraDir) {
    return (
      <div style={{ padding: "12px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
        Set a LoRA directory on Character Setup to browse installed LoRAs.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        <input
          style={{ flex: 1, fontSize: "11px" }}
          placeholder="filter loras…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="btn-ghost" onClick={scanLoras} style={{ padding: "4px 10px", fontSize: "10px" }}>Rescan</button>
      </div>
      {!loaded
        ? <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>Scanning…</div>
        : filtered.length === 0
          ? <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>No LoRAs found</div>
          : groups.map(([dir, files]) => (
            <div key={dir || "__root__"}>
              {dir && (
                <div
                  onClick={() => toggleDir(dir)}
                  style={{
                    padding: "4px 0", marginTop: "4px",
                    fontFamily: "var(--font-mono)", fontSize: "10px",
                    color: "var(--text-muted)", letterSpacing: "0.08em",
                    cursor: "pointer", userSelect: "none",
                    display: "flex", alignItems: "center", gap: "5px",
                  }}
                >
                  {collapsedDirs.has(dir) ? "▶" : "▼"} {dir}/
                </div>
              )}
              {!collapsedDirs.has(dir) && files.map((lora) => (
                <div key={lora.path} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", borderBottom: "1px solid var(--border)", paddingLeft: dir ? "12px" : "0" }}>
                  <div style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lora.name}>
                    {lora.name}
                  </div>
                  <input
                    type="number" min={0.1} max={2.0} step={0.1}
                    value={getWeight(lora.name)}
                    onChange={(e) => setWeights((w) => ({ ...w, [lora.name]: parseFloat(e.target.value) || 0.8 }))}
                    style={{ width: "52px", padding: "2px 4px", fontSize: "11px", textAlign: "center" }}
                  />
                  <button
                    onClick={() => onInsert(`<lora:${lora.name}:${getWeight(lora.name)}>`)}
                    style={{
                      padding: "3px 8px", fontSize: "10px",
                      background: "var(--accent-glow)", border: "1px solid var(--accent-dim)",
                      color: "var(--accent-bright)", borderRadius: "3px", cursor: "pointer",
                      fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em",
                      textTransform: "uppercase",
                    }}
                  >+ Insert</button>
                </div>
              ))}
            </div>
          ))
      }
    </div>
  );
}

// ── Settings Panel ─────────────────────────────────────────────────────────────
function SettingsPanel() {
  const { generation, updateGeneration, character, settings } = useStore();
  const training = useStore((s) => s.training);
  const ezMode = settings.ezMode ?? false;
  const [showLoras, setShowLoras] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (ezMode) {
      updateGeneration({
        width: training?.sdxl !== false ? 1024 : 512,
        height: training?.sdxl !== false ? 1024 : 512,
        count: 1,
      });
    }
  }, [ezMode]);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "12px", overflow: "hidden" }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", cursor: "pointer", background: "var(--bg-3)", userSelect: "none" }}
      >
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700 }}>Settings</div>
        {ezMode && <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--accent-bright)", background: "var(--accent-glow)", border: "1px solid var(--accent-dim)", borderRadius: "3px", padding: "1px 6px", letterSpacing: "0.1em" }}>EZ</div>}
        <div style={{ flex: 1 }} />
        {collapsed ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronUp size={13} color="var(--text-muted)" />}
      </div>

      {!collapsed && (
        <div style={{ padding: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", opacity: ezMode ? 0.5 : 1, pointerEvents: ezMode ? "none" : "auto" }}>
            {/* Size */}
            <div>
              <div className="section-label">Image Size</div>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                {SIZE_PRESETS.map((s) => (
                  <button key={s.label} onClick={() => updateGeneration({ width: s.w, height: s.h })} style={{
                    padding: "3px 10px", fontSize: "10px", fontFamily: "var(--font-mono)",
                    background: generation.width === s.w && generation.height === s.h ? "var(--accent-glow)" : "var(--bg-3)",
                    border: `1px solid ${generation.width === s.w && generation.height === s.h ? "var(--accent-dim)" : "var(--border)"}`,
                    color: generation.width === s.w && generation.height === s.h ? "var(--accent-bright)" : "var(--text-muted)",
                    borderRadius: "3px", cursor: "pointer", letterSpacing: 0, textTransform: "none", fontWeight: 400,
                  }}>{s.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "6px", alignItems: "center" }}>
                <input type="number" step={64} min={512} max={2048} style={{ width: "72px" }} value={generation.width} onChange={(e) => updateGeneration({ width: parseInt(e.target.value) || 1024 })} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>×</span>
                <input type="number" step={64} min={512} max={2048} style={{ width: "72px" }} value={generation.height} onChange={(e) => updateGeneration({ height: parseInt(e.target.value) || 1024 })} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>px</span>
              </div>
            </div>

            {/* Count + extras */}
            <div>
              <div className="section-label">Images per Combination</div>
              <input type="number" min={1} max={20} style={{ width: "70px", marginTop: "4px" }} value={generation.count} onChange={(e) => updateGeneration({ count: parseInt(e.target.value) || 1 })} />
              <div style={{ marginTop: "12px" }}>
                <div className="section-label">Extra Tags <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(added to every prompt)</span></div>
                <input style={{ width: "100%", marginTop: "4px" }} placeholder="rain, umbrella, night" value={generation.extras} onChange={(e) => updateGeneration({ extras: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Embeddings */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "16px" }}>
            <div>
              <div className="section-label">Positive Embeddings <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(added to prompt)</span></div>
              <div style={{ marginTop: "4px" }}>
                <ChipInput
                  values={generation.positiveEmbeddings}
                  onChange={(v) => updateGeneration({ positiveEmbeddings: v })}
                  placeholder="e.g. style-name, quality-token"
                />
              </div>
            </div>
            <div>
              <div className="section-label">Negative Embeddings <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(added to negative prompt)</span></div>
              <div style={{ marginTop: "4px" }}>
                <ChipInput
                  values={generation.negativeEmbeddings}
                  onChange={(v) => updateGeneration({ negativeEmbeddings: v })}
                  placeholder="e.g. easynegative, badhandv4"
                />
              </div>
            </div>
          </div>

          {/* LoRAs */}
          <div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div className="section-label">Active LoRAs</div>
              {generation.loras.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {generation.loras.map((l) => (
                    <div key={l} style={{
                      display: "inline-flex", alignItems: "center", gap: "3px",
                      padding: "2px 6px 2px 9px",
                      background: "var(--bg-3)", border: "1px solid var(--border)",
                      borderRadius: "3px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)",
                    }}>
                      {l.length > 40 ? l.slice(0, 40) + "…" : l}
                      <button
                        onClick={() => updateGeneration({ loras: generation.loras.filter((x) => x !== l) })}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0 0 0 2px", fontSize: "13px", lineHeight: 1, display: "flex", alignItems: "center" }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowLoras(!showLoras)}
              className="btn-ghost"
              style={{
                marginTop: "8px", display: "flex", alignItems: "center", gap: "6px",
                padding: "5px 12px", fontSize: "10px",
                background: showLoras ? "var(--accent-glow)" : undefined,
                border: showLoras ? "1px solid var(--accent-dim)" : undefined,
                color: showLoras ? "var(--accent-bright)" : undefined,
              }}
            >
              <Layers size={10} />LoRA Browser
            </button>
            {showLoras && (
              <div style={{ marginTop: "8px", padding: "12px", background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                <LoraBrowser onInsert={(tag) => {
                  if (!generation.loras.includes(tag)) {
                    updateGeneration({ loras: [...generation.loras, tag] });
                  }
                }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pose Category Panel ────────────────────────────────────────────────────────
function PoseCategoryPanel({
  values,
  onChange,
  presets,
  loraFiles,
}: {
  values: PoseEntry[];
  onChange: (v: PoseEntry[]) => void;
  presets: string[];
  loraFiles: { name: string; path: string; dir: string }[];
}) {
  const [showPresets, setShowPresets] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const update = (i: number, patch: Partial<PoseEntry>) => {
    const next = [...values]; next[i] = { ...next[i], ...patch }; onChange(next);
  };
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const addPreset = (p: string) => {
    if (!values.some((v) => v.prompt === p)) onChange([...values, { prompt: p }]);
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "12px", overflow: "hidden" }}>
      <div onClick={() => setCollapsed(!collapsed)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", cursor: "pointer", background: "var(--bg-3)", userSelect: "none" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--accent-bright)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Poses / Framing</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>{values.length} variant{values.length !== 1 ? "s" : ""}</div>
        <div style={{ flex: 1 }} />
        {collapsed ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronUp size={13} color="var(--text-muted)" />}
      </div>
      {!collapsed && (
        <div style={{ padding: "12px 16px" }}>
          {values.map((v, i) => (
            <div key={i} style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", width: "18px", textAlign: "right", flexShrink: 0 }}>{i + 1}</div>
                <input style={{ flex: 1 }} value={v.prompt} placeholder="e.g. standing, full body, arms crossed" onChange={(e) => update(i, { prompt: e.target.value })} />
                <button onClick={() => remove(i)} className="btn-ghost" style={{ padding: "4px 8px", fontSize: "14px", flexShrink: 0, color: "var(--text-muted)", lineHeight: 1 }}>×</button>
              </div>
              {loraFiles.length > 0 && (
                <InlineLoraAdder
                  attached={v.loras ?? []}
                  loraFiles={loraFiles}
                  onAdd={(tag) => update(i, { loras: [...(v.loras ?? []), tag] })}
                  onRemove={(tag) => update(i, { loras: (v.loras ?? []).filter((l) => l !== tag) })}
                />
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button className="btn-ghost" onClick={() => onChange([...values, { prompt: "" }])} style={{ padding: "5px 12px", fontSize: "10px" }}>
              <Plus size={10} style={{ display: "inline", marginRight: "4px" }} />Add
            </button>
            <button className="btn-ghost" onClick={() => setShowPresets(!showPresets)} style={{ padding: "5px 12px", fontSize: "10px", background: showPresets ? "var(--accent-glow)" : undefined, border: showPresets ? "1px solid var(--accent-dim)" : undefined, color: showPresets ? "var(--accent-bright)" : undefined }}>
              Presets {showPresets ? "▲" : "▼"}
            </button>
          </div>
          {showPresets && (
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "8px" }}>
              {presets.map((p) => (
                <button key={p} onClick={() => addPreset(p)} style={{ padding: "3px 9px", fontSize: "10px", fontFamily: "var(--font-mono)", background: values.some((v) => v.prompt === p) ? "var(--accent-glow)" : "var(--bg-3)", border: `1px solid ${values.some((v) => v.prompt === p) ? "var(--accent-dim)" : "var(--border)"}`, color: values.some((v) => v.prompt === p) ? "var(--accent-bright)" : "var(--text-muted)", borderRadius: "3px", cursor: values.some((v) => v.prompt === p) ? "default" : "pointer", letterSpacing: 0, textTransform: "none", fontWeight: 400 }}>
                  {p.length > 36 ? p.slice(0, 36) + "…" : p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dynamic Prompts Panel ──────────────────────────────────────────────────────
function DynamicPromptsPanel({
  character,
  generation,
}: {
  character: Parameters<typeof buildDynamicPromptsBlock>[0];
  generation: Parameters<typeof buildDynamicPromptsBlock>[1];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const block = buildDynamicPromptsBlock(character, generation);

  const copy = () => {
    navigator.clipboard.writeText(block).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", marginTop: "12px", overflow: "hidden" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", cursor: "pointer", background: "var(--bg-3)", userSelect: "none" }}
      >
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700 }}>
          Dynamic Prompts Export
        </div>
        <div style={{ flex: 1 }} />
        {open ? <ChevronUp size={13} color="var(--text-muted)" /> : <ChevronDown size={13} color="var(--text-muted)" />}
      </div>

      {open && (
        <div style={{ padding: "12px 16px" }}>
          <textarea
            readOnly
            value={block || "(add variants above to generate a block)"}
            style={{
              width: "100%", height: "80px", resize: "vertical",
              fontFamily: "var(--font-mono)", fontSize: "11px",
              color: block ? "var(--accent-bright)" : "var(--text-muted)",
              background: "var(--bg-1)", border: "1px solid var(--border)",
              borderRadius: "4px", padding: "8px", lineHeight: 1.6,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" }}>
            <button
              onClick={copy}
              disabled={!block}
              style={{
                padding: "5px 14px", fontSize: "10px",
                background: copied ? "var(--accent-glow)" : "var(--bg-3)",
                border: `1px solid ${copied ? "var(--accent-dim)" : "var(--border)"}`,
                color: copied ? "var(--accent-bright)" : "var(--text-muted)",
                borderRadius: "4px", cursor: block ? "pointer" : "default",
                fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
              Picks one random combination per image — not the full cartesian product
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function ShotList() {
  const { generation, updateGeneration, character, images, updateImage, projectLoadCount, settings } = useStore();
  const ezMode = settings.ezMode ?? false;
  const [loraFiles, setLoraFiles] = useState<{ name: string; path: string; dir: string }[]>([]);

  // Track committed outfit trigger words to detect changes
  const [committedOutfitTriggers, setCommittedOutfitTriggers] = useState<(string | undefined)[]>(
    generation.outfits.map((o) => o.triggerWord)
  );
  const [updatingCaptions, setUpdatingCaptions] = useState(false);

  // Reset baseline whenever a project is loaded — avoids false-positive banner
  useEffect(() => {
    setCommittedOutfitTriggers(generation.outfits.map((o) => o.triggerWord));
  }, [projectLoadCount]);

  const outfitTriggerChanges = generation.outfits.reduce<{ oldTrigger: string; newTrigger: string }[]>((acc, outfit, i) => {
    const old = committedOutfitTriggers[i];
    const next = outfit.triggerWord;
    if (old && next && old !== next) acc.push({ oldTrigger: old, newTrigger: next });
    return acc;
  }, []);
  const hasChanges = outfitTriggerChanges.length > 0 && images.length > 0;

  const updateOutfitTriggerCaptions = async () => {
    setUpdatingCaptions(true);
    for (const img of images) {
      let tags = img.caption.split(",").map((t) => t.trim()).filter(Boolean);
      for (const { oldTrigger, newTrigger } of outfitTriggerChanges) {
        tags = tags.map((t) => t.toLowerCase() === oldTrigger.toLowerCase() ? newTrigger : t);
        if (!tags.some((t) => t.toLowerCase() === newTrigger.toLowerCase())) {
          tags.unshift(newTrigger);
        }
      }
      const updated = tags.join(", ");
      try {
        await invoke("save_caption", { imagePath: img.path, caption: updated });
        updateImage(img.id, { caption: updated });
      } catch {}
    }
    setCommittedOutfitTriggers(generation.outfits.map((o) => o.triggerWord));
    setUpdatingCaptions(false);
  };

  useEffect(() => {
    if (!character.loraDir) return;
    invoke<string[]>("list_lora_files", { dir: character.loraDir }).then((files) => {
      const base = character.loraDir.replace(/\\/g, "/").replace(/\/$/, "");
      setLoraFiles(files.map((p) => {
        const norm = p.replace(/\\/g, "/");
        const rel = norm.startsWith(base + "/") ? norm.slice(base.length + 1) : norm;
        const parts = rel.split("/");
        const filename = parts.pop()!;
        const name = filename.replace(/\.(safetensors|pt|ckpt)$/i, "");
        return { name, path: norm, dir: parts.join("/") };
      }));
    }).catch(() => {});
  }, [character.loraDir]);

  const permCount =
    Math.max(1, generation.poses.length) *
    Math.max(1, generation.outfits.length) *
    Math.max(1, generation.expressions.length) *
    Math.max(1, generation.backgrounds.length);
  const totalImages = permCount * generation.count;

  const previewPrompt = [
    character.triggerWord,
    character.baseDescription,
    character.artistTags ? `style of ${character.artistTags}` : "",
    generation.poses[0]?.prompt ?? "",
    generation.outfits[0]?.triggerWord ?? "",
    generation.outfits[0]?.prompt ?? "",
    generation.expressions[0] ?? "",
    generation.backgrounds[0] ?? "",
    generation.extras,
    ...generation.loras,
  ].map((s) => normSeg(s)).filter((s) => s.length > 0).join(", ");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader
        title="Shot List"
        subtitle="Define variants per category — the generator produces all combinations"
        actions={
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", padding: "6px 12px", background: "var(--bg-3)", borderRadius: "4px", border: "1px solid var(--border)" }}>
            {permCount} combo{permCount !== 1 ? "s" : ""} × {generation.count} = {totalImages} images planned
          </div>
        }
      />
      {hasChanges && (
        <div style={{ padding: "10px 28px", background: "var(--accent-glow)", borderBottom: "1px solid var(--accent-dim)", flexShrink: 0, display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent-bright)", flex: 1 }}>
            Outfit trigger word{outfitTriggerChanges.length !== 1 ? "s" : ""} changed ({outfitTriggerChanges.map(c => `${c.oldTrigger} → ${c.newTrigger}`).join(", ")}). Update {images.length} caption{images.length !== 1 ? "s" : ""}?
          </span>
          <button
            onClick={updateOutfitTriggerCaptions}
            disabled={updatingCaptions}
            style={{ padding: "5px 14px", fontSize: "11px", cursor: "pointer", background: "var(--accent)", border: "none", color: "white", borderRadius: "4px", fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.04em", flexShrink: 0 }}
          >
            {updatingCaptions ? "Updating…" : `Update ${images.length} caption${images.length !== 1 ? "s" : ""}`}
          </button>
          <button
            onClick={() => setCommittedOutfitTriggers(generation.outfits.map((o) => o.triggerWord))}
            style={{ padding: "5px 14px", fontSize: "11px", cursor: "pointer", background: "transparent", border: "1px solid var(--accent-dim)", color: "var(--accent-bright)", borderRadius: "4px", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em", flexShrink: 0 }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
        <PoseCategoryPanel
          values={generation.poses}
          onChange={(v) => updateGeneration({ poses: v })}
          presets={POSE_PRESETS}
          loraFiles={loraFiles}
        />
        <CategoryPanel
          label="Expressions"
          values={generation.expressions}
          onChange={(v) => updateGeneration({ expressions: v })}
          presets={EXPRESSION_PRESETS}
          placeholder="e.g. smiling and tired, looking away"
          accentColor="#7eb8d4"
        />
        <OutfitCategoryPanel
          values={generation.outfits}
          onChange={(v) => updateGeneration({ outfits: v })}
          presets={OUTFIT_PRESETS}
          loraFiles={loraFiles}
        />
        <CategoryPanel
          label="Backgrounds"
          values={generation.backgrounds}
          onChange={(v) => updateGeneration({ backgrounds: v })}
          presets={BACKGROUND_PRESETS}
          placeholder="e.g. outdoors, city street, evening lighting"
          accentColor="#c8a078"
        />
        <SettingsPanel />

        {/* Prompt preview */}
        <div style={{ padding: "12px 14px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "8px" }}>
          <div className="section-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Prompt Preview</span>
            {permCount > 1 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>showing combo 1 of {permCount}</span>}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent-bright)", lineHeight: 1.6, marginTop: "6px", wordBreak: "break-word" }}>
            {previewPrompt || <span style={{ color: "var(--text-muted)" }}>Add variants above to see a preview…</span>}
          </div>
        </div>

        {!ezMode && <DynamicPromptsPanel character={character} generation={generation} />}
      </div>
    </div>
  );
}
