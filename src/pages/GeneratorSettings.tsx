import { useEffect } from "react";
import PageHeader from "../components/PageHeader";
import { useStore } from "../store";

const SAMPLERS = [
  "Euler", "Euler a", "Euler CFG++",
  "DPM++ 2M", "DPM++ 2M SDE",
  "DPM++ 3M SDE",
  "DPM++ SDE",
  "DDIM", "PLMS", "UniPC", "Heun",
  "LMS",
];

const SCHEDULERS = [
  "Automatic", "Uniform", "Karras", "Exponential", "Polyexponential",
  "SGM Uniform", "KL Optimal", "Align Your Steps", "Simple", "Normal", "DDIM",
];

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  hint?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
        <div className="section-label">{label}</div>
        <input
          type="number"
          min={min} max={max} step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || min)}
          style={{ width: "72px", textAlign: "right" }}
        />
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }}
      />
      {hint && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function SelectGrid({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: "8px" }}>{label}</div>
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: "4px 10px", fontSize: "11px",
              fontFamily: "var(--font-mono)",
              background: value === opt ? "var(--accent-glow)" : "var(--bg-3)",
              border: `1px solid ${value === opt ? "var(--accent-dim)" : "var(--border)"}`,
              color: value === opt ? "var(--accent-bright)" : "var(--text-muted)",
              borderRadius: "3px", cursor: "pointer",
              letterSpacing: 0, textTransform: "none", fontWeight: value === opt ? 600 : 400,
              transition: "all 0.1s",
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function GeneratorSettings() {
  const { generation, updateGeneration, settings } = useStore();
  const ezMode = settings.ezMode ?? false;

  useEffect(() => {
    if (ezMode) {
      updateGeneration({ steps: 20, cfgScale: 7, samplerName: "DPM++ 2M", scheduler: "Karras" });
    }
  }, [ezMode]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader
        title="Generator Settings"
        subtitle="Sampler, scheduler, steps, and CFG — applied to every generation"
      />
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px" }}>
        {ezMode && (
          <div style={{ marginBottom: "16px", padding: "10px 16px", background: "var(--accent-glow)", border: "1px solid var(--accent-dim)", borderRadius: "6px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent-bright)", letterSpacing: "0.04em" }}>
            ⚡ EZ Mode — settings auto-managed. Disable EZ Mode in the sidebar to edit.
          </div>
        )}
        <div style={{ maxWidth: "720px", display: "flex", flexDirection: "column", gap: "28px", opacity: ezMode ? 0.5 : 1, pointerEvents: ezMode ? "none" : "auto" }}>

          {/* Steps + CFG side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px" }}>
            <SliderField
              label="Steps"
              value={generation.steps}
              onChange={(v) => updateGeneration({ steps: Math.round(v) })}
              min={1} max={150} step={1}
              hint="20–30 is typical for DPM++ samplers. Euler a / DDIM may need 50+."
            />
            <SliderField
              label="CFG Scale"
              value={generation.cfgScale}
              onChange={(v) => updateGeneration({ cfgScale: v })}
              min={1} max={20} step={0.5}
              hint="How closely to follow the prompt. 5–9 for SDXL/Illustrious, 7 for SD1.5."
            />
          </div>

          <div style={{ height: "1px", background: "var(--border)" }} />

          <SelectGrid
            label="Sampler"
            options={SAMPLERS}
            value={generation.samplerName}
            onChange={(v) => updateGeneration({ samplerName: v })}
          />

          <div style={{ height: "1px", background: "var(--border)" }} />

          <SelectGrid
            label="Scheduler"
            options={SCHEDULERS}
            value={generation.scheduler}
            onChange={(v) => updateGeneration({ scheduler: v })}
          />

          {/* Summary */}
          <div style={{
            padding: "12px 16px",
            background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "6px",
            fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-secondary)",
            lineHeight: 1.8,
          }}>
            <span style={{ color: "var(--text-muted)" }}>Active config: </span>
            {generation.samplerName} · {generation.scheduler} · {generation.steps} steps · CFG {generation.cfgScale}
          </div>

        </div>
      </div>
    </div>
  );
}
