import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Save, RefreshCw, Filter } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore, GeneratedImage } from "../store";

type FilterMode = "all" | "approved" | "pending";

function normalizeCaption(caption: string, triggerWord: string): string {
  if (!triggerWord) return caption;
  const tags = caption.split(",").map((t) => t.trim()).filter(Boolean);
  const rest = tags.filter((t) => t.toLowerCase() !== triggerWord.toLowerCase());
  return [triggerWord, ...rest].join(", ");
}

export default function CaptionEditor() {
  const { images, character, updateImage } = useStore();
  const [filter, setFilter] = useState<FilterMode>("approved");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = images.filter((img) => {
    if (filter === "approved") return img.approved === true;
    if (filter === "pending") return img.approved === null;
    return true;
  });

  const selectedImg = images.find((i) => i.id === selected) ?? filtered[0] ?? null;

  const saveCaption = async (img: GeneratedImage, caption: string) => {
    const normalized = normalizeCaption(caption, character.triggerWord);
    setSaving(true);
    try {
      await invoke("save_caption", { imagePath: img.path, caption: normalized });
      updateImage(img.id, { caption: normalized });
    } finally {
      setSaving(false);
    }
  };

  const saveAllCaptions = async () => {
    setSaving(true);
    for (const img of filtered) {
      const normalized = normalizeCaption(img.caption, character.triggerWord);
      await invoke("save_caption", { imagePath: img.path, caption: normalized });
      updateImage(img.id, { caption: normalized });
    }
    setSaving(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader
        title="Caption Editor"
        subtitle="Review and edit booru tags before training"
        actions={
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-ghost" onClick={saveAllCaptions} disabled={saving}>
              <Save size={12} style={{ display: "inline", marginRight: "5px" }} />
              {saving ? "Saving…" : `Save All (${filtered.length})`}
            </button>
          </div>
        }
      />

      {/* Filter bar */}
      <div style={{
        display: "flex",
        gap: "2px",
        padding: "10px 28px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        background: "var(--bg-1)",
      }}>
        <Filter size={13} color="var(--text-muted)" style={{ marginRight: "8px", alignSelf: "center" }} />
        {(["approved", "pending", "all"] as FilterMode[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 14px",
              fontSize: "11px",
              background: filter === f ? "var(--bg-4)" : "transparent",
              border: `1px solid ${filter === f ? "var(--accent-dim)" : "var(--border)"}`,
              color: filter === f ? "var(--accent-bright)" : "var(--text-muted)",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {f} ({f === "approved" ? images.filter(i => i.approved === true).length : f === "pending" ? images.filter(i => i.approved === null).length : images.length})
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: thumbnail strip */}
        <div style={{
          width: "160px",
          borderRight: "1px solid var(--border)",
          overflow: "auto",
          flexShrink: 0,
          background: "var(--bg-1)",
        }}>
          {filtered.length === 0 && (
            <div style={{
              padding: "20px 12px",
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-muted)",
              textAlign: "center",
            }}>No images in this filter</div>
          )}
          {filtered.map((img) => (
            <ThumbnailItem
              key={img.id}
              img={img}
              selected={selectedImg?.id === img.id}
              onClick={() => setSelected(img.id)}
            />
          ))}
        </div>

        {/* Right: editor */}
        {selectedImg ? (
          <CaptionEditorPanel
            img={selectedImg}
            triggerWord={character.triggerWord}
            onSave={saveCaption}
            saving={saving}
          />
        ) : (
          <div style={{
            flex: 1, display: "flex", alignItems: "center",
            justifyContent: "center", flexDirection: "column", gap: "8px",
          }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--text-muted)" }}>
              Select an image to edit its caption
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ThumbnailItem({ img, selected, onClick }: { img: GeneratedImage; selected: boolean; onClick: () => void }) {
  const [b64, setB64] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (b64) return;
    try {
      const data = await invoke<string>("read_image_b64", { path: img.path });
      setB64(data);
    } catch {}
  }, [img.path, b64]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={load}
      style={{
        padding: "6px",
        cursor: "pointer",
        background: selected ? "var(--bg-3)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "all 0.1s",
      }}
    >
      <div style={{
        aspectRatio: "1",
        background: "var(--bg-3)",
        borderRadius: "4px",
        overflow: "hidden",
      }}>
        {b64 ? (
          <img src={`data:image/png;base64,${b64}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{
            width: "100%", height: "100%", display: "flex",
            alignItems: "center", justifyContent: "center",
            fontSize: "9px", fontFamily: "var(--font-mono)", color: "var(--text-muted)",
          }}>…</div>
        )}
      </div>
    </div>
  );
}

function CaptionEditorPanel({ img, triggerWord, onSave, saving }: {
  img: GeneratedImage;
  triggerWord: string;
  onSave: (img: GeneratedImage, caption: string) => void;
  saving: boolean;
}) {
  const [b64, setB64] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState(img.caption);
  const { updateImage } = useStore();

  const load = useCallback(async () => {
    try {
      const data = await invoke<string>("read_image_b64", { path: img.path });
      setB64(data);
    } catch {}
  }, [img.path]);

  // Reset edit state when image changes
  useEffect(() => { setEditCaption(img.caption); }, [img.id]);

  // Parse tags
  const tags = editCaption.split(",").map((t) => t.trim()).filter(Boolean);
  const isModified = editCaption !== img.caption;

  const removeTag = (tag: string) => {
    const updated = tags.filter((t) => t !== tag).join(", ");
    setEditCaption(updated);
    updateImage(img.id, { caption: updated });
  };

  const addTag = (tag: string) => {
    if (!tag.trim() || tags.includes(tag.trim())) return;
    const updated = [...tags, tag.trim()].join(", ");
    setEditCaption(updated);
    updateImage(img.id, { caption: updated });
  };

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* Image */}
      <div style={{
        width: "380px",
        flexShrink: 0,
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}>
        <div
          style={{
            aspectRatio: "1",
            background: "var(--bg-3)",
            borderRadius: "8px",
            overflow: "hidden",
            cursor: "pointer",
          }}
          onClick={load}
        >
          {b64 ? (
            <img src={`data:image/png;base64,${b64}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div
              style={{
                width: "100%", height: "100%", display: "flex",
                alignItems: "center", justifyContent: "center",
                flexDirection: "column", gap: "8px",
              }}
              onClick={load}
            >
              <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                Click to load image
              </div>
            </div>
          )}
        </div>

        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--text-muted)",
          lineHeight: 1.5,
          padding: "8px",
          background: "var(--bg-2)",
          borderRadius: "4px",
          border: "1px solid var(--border)",
        }}>
          <div style={{ color: "var(--text-secondary)", marginBottom: "3px" }}>seed: {img.seed}</div>
          <div style={{ wordBreak: "break-all" }}>{img.path.split("/").pop()}</div>
        </div>
      </div>

      {/* Caption editor */}
      <div style={{ flex: 1, padding: "20px 20px 20px 0", display: "flex", flexDirection: "column", gap: "16px", overflow: "auto" }}>
        {/* Tag chips */}
        <div>
          <div className="section-label">Tags ({tags.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
            {tags.map((tag) => (
              <div
                key={tag}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 8px 3px 10px",
                  borderRadius: "3px",
                  background: tag === triggerWord ? "var(--accent-glow)" : "var(--bg-3)",
                  border: `1px solid ${tag === triggerWord ? "var(--accent-dim)" : "var(--border)"}`,
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: tag === triggerWord ? "var(--accent-bright)" : "var(--text-secondary)",
                }}
              >
                {tag}
                {tag !== triggerWord && (
                  <button
                    onClick={() => removeTag(tag)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--text-muted)", padding: "0 0 0 2px",
                      fontSize: "13px", lineHeight: 1, fontWeight: 400,
                      display: "flex", alignItems: "center",
                    }}
                  >×</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Add tag */}
        <div>
          <div className="section-label">Add Tag</div>
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <input
              style={{ flex: 1 }}
              placeholder="type a tag and press Enter"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addTag((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = "";
                }
              }}
            />
          </div>
        </div>

        {/* Raw edit */}
        <div style={{ flex: 1 }}>
          <div className="section-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Raw Caption</span>
            {isModified && <span style={{ color: "var(--accent)", fontSize: "9px" }}>MODIFIED</span>}
          </div>
          <textarea
            style={{ width: "100%", minHeight: "120px", resize: "vertical", marginTop: "4px" }}
            value={editCaption}
            onChange={(e) => {
              setEditCaption(e.target.value);
              updateImage(img.id, { caption: e.target.value });
            }}
          />
        </div>

        <button
          className="btn-primary"
          onClick={() => onSave(img, editCaption)}
          disabled={saving}
          style={{ alignSelf: "flex-start" }}
        >
          <Save size={12} style={{ display: "inline", marginRight: "5px" }} />
          {saving ? "Saving…" : "Save Caption"}
        </button>
      </div>
    </div>
  );
}
