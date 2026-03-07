import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Save, FolderInput, Clock, X, FilePlus } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore, GeneratedImage } from "../store";

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: "20px" }}>
    <div className="section-label">{label}</div>
    {hint && <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "14px", color: "var(--text-muted)", marginBottom: "6px" }}>{hint}</div>}
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
  const { character, setCharacter, settings, setSettings, importProject, images, updateGeneration, clearImages, markSaved } = useStore();
  const [confirmNew, setConfirmNew] = useState(false);

  const addToRecents = (name: string, outputDir: string) => {
    const recents = settings.recentProjects ?? [];
    const filtered = recents.filter((r) => r.outputDir !== outputDir);
    setSettings({ recentProjects: [{ name, outputDir }, ...filtered].slice(0, 10) });
  };

  const saveProject = async () => {
    if (!character.outputDir) return;
    await invoke("ensure_dir", { path: character.outputDir });
    const path = `${character.outputDir}/project.json`;
    const { character: c, generation, settings: s, images: imgs } = useStore.getState();
    await invoke("save_project", { path, data: JSON.stringify({ character: c, generation, settings: s, images: imgs }, null, 2) });
    addToRecents(c.name || c.triggerWord || "Unnamed", c.outputDir);
    markSaved();
  };

  const loadFromDir = async (dir?: string) => {
    const outputDir = dir ?? await invoke<string | null>("pick_directory");
    if (!outputDir) return;
    try {
      const raw = await invoke<string>("load_project", { path: `${outputDir}/project.json` });
      const data = JSON.parse(raw);

      // Remap image paths to the actual outputDir (handles archive extractions to a new location)
      let loadedImages: GeneratedImage[] = data.images ?? [];
      if (loadedImages.length > 0 && data.character?.outputDir && data.character.outputDir !== outputDir) {
        const oldBase = data.character.outputDir.replace(/\\/g, "/").replace(/\/$/, "");
        loadedImages = loadedImages.map((img) => ({
          ...img,
          path: img.path.replace(/\\/g, "/").replace(oldBase, outputDir.replace(/\\/g, "/")),
        }));
      }

      // Fallback: scan directory for images not captured in project.json
      if (loadedImages.length === 0) {
        const files = await invoke<string[]>("list_images_in_dir", { dir: outputDir }).catch(() => []);
        loadedImages = await Promise.all(files.map(async (filePath) => {
          const caption = await invoke<string>("load_caption", { imagePath: filePath }).catch(() => "");
          const id = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? filePath;
          return { id, shotId: "", path: filePath, prompt: "", caption, approved: null, seed: 0, width: 0, height: 0 } as GeneratedImage;
        }));
      }

      importProject({ ...data, images: loadedImages });
      addToRecents(data.character?.name || data.character?.triggerWord || "Unnamed", outputDir);
    } catch {
      // no project.json found or unreadable
    }
  };

  const loadFromArchive = async () => {
    const archivePath = await invoke<string | null>("pick_file", { filterName: "Archive", extensions: ["zip", "tar.gz", "tgz"] });
    if (!archivePath) return;
    const destDir = await invoke<string | null>("pick_directory");
    if (!destDir) return;
    try {
      await invoke("extract_archive", { archivePath, destDir });
      await loadFromDir(destDir);
    } catch {
      // extraction failed
    }
  };

  const removeFromRecents = (outputDir: string) => {
    const recents = settings.recentProjects ?? [];
    setSettings({ recentProjects: recents.filter((r) => r.outputDir !== outputDir) });
  };

  const newCharacter = () => {
    // Preserve studio-level settings, reset everything character-specific
    setCharacter({
      name: "", triggerWord: "", species: "",
      baseDescription: "", artistTags: "", outputDir: "",
      // baseModel and loraDir are intentionally kept
    });
    updateGeneration({
      poses: [], outfits: [], expressions: [], backgrounds: [],
      extras: "", loras: [], positiveEmbeddings: [], negativeEmbeddings: [],
      // steps, cfgScale, samplerName, scheduler, count, width, height are kept
    });
    clearImages();
    markSaved();
    setConfirmNew(false);
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
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-ghost" onClick={() => setConfirmNew(true)}>
              <FilePlus size={12} style={{ display: "inline", marginRight: "6px" }} />New Character
            </button>
            <button className="btn-ghost" onClick={loadFromArchive}>
              <FolderInput size={12} style={{ display: "inline", marginRight: "6px" }} />Load Archive
            </button>
            <button className="btn-ghost" onClick={() => loadFromDir()}>
              <FolderInput size={12} style={{ display: "inline", marginRight: "6px" }} />Load Directory
            </button>
            <button className="btn-primary" onClick={saveProject} disabled={!character.outputDir}>
              <Save size={12} style={{ display: "inline", marginRight: "6px" }} />Save Project
            </button>
          </div>
        }
      />
      {confirmNew && (
        <div style={{ padding: "10px 28px", background: "rgba(154,74,74,0.12)", borderBottom: "1px solid var(--red)", flexShrink: 0, display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "#d47070", flex: 1 }}>
            This will clear all character fields, shot list, and images. Checkpoint, LoRA directory, and sampler settings will be kept.
          </span>
          <button onClick={newCharacter} style={{ padding: "5px 14px", fontSize: "11px", cursor: "pointer", background: "var(--red)", border: "none", color: "white", borderRadius: "4px", fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0 }}>
            Clear &amp; start fresh
          </button>
          <button onClick={() => setConfirmNew(false)} style={{ padding: "5px 14px", fontSize: "11px", cursor: "pointer", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "4px", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em", flexShrink: 0 }}>
            Cancel
          </button>
        </div>
      )}

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

          {(settings.recentProjects ?? []).length > 0 && (
            <div style={{ gridColumn: "1 / -1", marginTop: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                <Clock size={12} color="var(--text-muted)" />
                <div className="section-label" style={{ margin: 0 }}>Recent Characters</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {(settings.recentProjects ?? []).map((r) => (
                  <div
                    key={r.outputDir}
                    style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "10px 14px",
                      background: r.outputDir === character.outputDir ? "var(--accent-glow)" : "var(--bg-2)",
                      border: `1px solid ${r.outputDir === character.outputDir ? "var(--accent-dim)" : "var(--border)"}`,
                      borderRadius: "6px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, color: r.outputDir === character.outputDir ? "var(--accent-bright)" : "var(--text-primary)" }}>
                        {r.name || "Unnamed"}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                        {r.outputDir}
                      </div>
                    </div>
                    {r.outputDir !== character.outputDir && (
                      <button
                        className="btn-ghost"
                        onClick={() => loadFromDir(r.outputDir)}
                        style={{ padding: "4px 12px", fontSize: "11px", flexShrink: 0 }}
                      >Load</button>
                    )}
                    <button
                      onClick={() => removeFromRecents(r.outputDir)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px", display: "flex", alignItems: "center", flexShrink: 0 }}
                      title="Remove from recents"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
