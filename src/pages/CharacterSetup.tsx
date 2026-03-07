import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Save } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore } from "../store";

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: "20px" }}>
    <div className="section-label">{label}</div>
    {hint && <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>{hint}</div>}
    {children}
  </div>
);

const DirField = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => {
  const pick = async () => {
    const selected = await invoke<string | null>("pick_directory");
    if (selected) onChange(selected);
  };
  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <input style={{ flex: 1 }} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <button className="btn-ghost" onClick={pick} style={{ flexShrink: 0 }}>
        <FolderOpen size={13} style={{ display: "inline", marginRight: "5px" }} />Browse
      </button>
    </div>
  );
};

export default function CharacterSetup() {
  const { character, setCharacter } = useStore();

  const saveProject = async () => {
    if (!character.outputDir) { console.error("Set an output directory first."); return; }
    await invoke("ensure_dir", { path: character.outputDir });
    const path = `${character.outputDir}/project.json`;
    const { character: c, generation, settings } = useStore.getState();
    await invoke("save_project", { path, data: JSON.stringify({ character: c, generation, settings }, null, 2) });
    console.log(`Saved to ${path}`);
  };

  const captionPreview = [
    character.triggerWord,
    character.baseDescription,
    character.artistTags ? `style of ${character.artistTags}` : "",
    "[pose], [outfit], [expression], [background]",
  ].filter(Boolean).join(", ");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader
        title="Character Setup"
        subtitle="Define the character identity and dataset configuration"
        actions={
          <button className="btn-primary" onClick={saveProject}>
            <Save size={12} style={{ display: "inline", marginRight: "6px" }} />Save Project
          </button>
        }
      />
      <div style={{ flex: 1, overflow: "auto", padding: "28px" }}>
        <div style={{ maxWidth: "680px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>

          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Character Name" hint="Human-readable name for your own reference">
              <input style={{ width: "100%" }} placeholder="e.g. Sable Foxworth" value={character.name} onChange={(e) => setCharacter({ name: e.target.value })} />
            </Field>
          </div>

          <Field label="Trigger Word" hint="Short, lowercase, uncommon token">
            <input style={{ width: "100%" }} placeholder="e.g. sablefox_v1" value={character.triggerWord} onChange={(e) => setCharacter({ triggerWord: e.target.value.toLowerCase().replace(/\s+/g, "_") })} />
          </Field>

          <Field label="Species" hint="Used to pre-populate shot list prompts">
            <input style={{ width: "100%" }} placeholder="e.g. red fox, anthro wolf" value={character.species} onChange={(e) => setCharacter({ species: e.target.value })} />
          </Field>

          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Core Description Tags" hint="Booru tags present in EVERY prompt — species, fur color, markings, eye color. Comma-separated.">
              <textarea style={{ width: "100%", minHeight: "80px", resize: "vertical" }}
                placeholder="anthro, red fox, female, orange fur, white chest, amber eyes, fluffy tail, pointed ears"
                value={character.baseDescription} onChange={(e) => setCharacter({ baseDescription: e.target.value })} />
            </Field>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Artist Tags" hint="Artists whose style you want to invoke. These appear in every prompt. Comma-separated.">
              <input style={{ width: "100%" }}
                placeholder="e.g. kenket, blotch, dark natasha"
                value={character.artistTags} onChange={(e) => setCharacter({ artistTags: e.target.value })} />
            </Field>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Base Checkpoint" hint="Model filename as Forge knows it">
              <input style={{ width: "100%" }} placeholder="illustriousXL_v01.safetensors" value={character.baseModel} onChange={(e) => setCharacter({ baseModel: e.target.value })} />
            </Field>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="LoRA Directory" hint="Stability Matrix LoRA folder — used by the LoRA browser on the Shot List page">
              <DirField
                value={character.loraDir}
                onChange={(v) => setCharacter({ loraDir: v })}
                placeholder="e.g. /home/jon/StabilityMatrix/Packages/.../models/Lora"
              />
            </Field>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Dataset Output Directory" hint="Where generated images and captions will be saved">
              <DirField value={character.outputDir} onChange={(v) => { setCharacter({ outputDir: v }); invoke("ensure_dir", { path: v }); }} placeholder="/mnt/nas/ai/datasets/sablefox" />
            </Field>
          </div>

          {character.triggerWord && (
            <div style={{ gridColumn: "1 / -1", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
              <div className="section-label">Caption Preview</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--accent-bright)", lineHeight: 1.7, marginTop: "6px" }}>
                {captionPreview}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
