import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, ChevronDown, ChevronUp, Layers } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore } from "../store";

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
interface LoraFile { name: string; path: string; }

function LoraBrowser({ onInsert }: { onInsert: (tag: string) => void }) {
  const { character } = useStore();
  const [loras, setLoras] = useState<LoraFile[]>([]);
  const [filter, setFilter] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  const scanLoras = async () => {
    if (!character.loraDir) return;
    try {
      const files = await invoke<string[]>("list_lora_files", { dir: character.loraDir });
      setLoras(files.map((p) => ({
        path: p,
        name: p.split("/").pop()?.replace(/\.(safetensors|pt|ckpt)$/i, "") ?? p,
      })));
      setLoaded(true);
    } catch (e) {
      console.error("LoRA scan failed:", e);
    }
  };

  useEffect(() => { if (character.loraDir) scanLoras(); }, [character.loraDir]);

  const filtered = loras.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase()));
  const getWeight = (name: string) => weights[name] ?? 0.8;

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
          : filtered.map((lora) => (
            <div key={lora.path} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
          ))
      }
    </div>
  );
}

// ── Settings Panel ─────────────────────────────────────────────────────────────
function SettingsPanel() {
  const { generation, updateGeneration, character } = useStore();
  const [showLoras, setShowLoras] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", marginBottom: "12px", overflow: "hidden" }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", cursor: "pointer", background: "var(--bg-3)", userSelect: "none" }}
      >
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700 }}>Settings</div>
        <div style={{ flex: 1 }} />
        {collapsed ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronUp size={13} color="var(--text-muted)" />}
      </div>

      {!collapsed && (
        <div style={{ padding: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
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

// ── Page ───────────────────────────────────────────────────────────────────────
export default function ShotList() {
  const { generation, updateGeneration, character } = useStore();

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
    generation.poses[0] ?? "",
    generation.outfits[0] ?? "",
    generation.expressions[0] ?? "",
    generation.backgrounds[0] ?? "",
    generation.extras,
    ...generation.loras,
  ].filter((s) => s && s.trim()).join(", ");

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
      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
        <CategoryPanel
          label="Poses / Framing"
          values={generation.poses}
          onChange={(v) => updateGeneration({ poses: v })}
          presets={POSE_PRESETS}
          placeholder="e.g. standing, full body, arms crossed"
          accentColor="var(--accent-bright)"
        />
        <CategoryPanel
          label="Expressions"
          values={generation.expressions}
          onChange={(v) => updateGeneration({ expressions: v })}
          presets={EXPRESSION_PRESETS}
          placeholder="e.g. smiling and tired, looking away"
          accentColor="#7eb8d4"
        />
        <CategoryPanel
          label="Outfits / Clothing"
          values={generation.outfits}
          onChange={(v) => updateGeneration({ outfits: v })}
          presets={OUTFIT_PRESETS}
          placeholder="e.g. casual outfit, jeans, a plain white t-shirt"
          accentColor="#a0c878"
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
      </div>
    </div>
  );
}
