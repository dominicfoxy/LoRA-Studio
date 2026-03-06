import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Square, RotateCcw, Check, X, Zap, ZoomIn } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore, GeneratedImage } from "../store";
import { base64ToBytes, deriveCaption } from "../lib/forge";

type Status = "idle" | "running" | "done";

function humanizeError(err: unknown): string {
  const s = String(err);
  if (s.includes("Connection refused") || s.includes("tcp connect error") || s.includes("error sending request"))
    return "Cannot reach Forge WebUI — is it running? Check the URL in Settings.";
  if (s.includes("timed out") || s.includes("deadline"))
    return "Forge WebUI timed out. It may still be loading or is overloaded.";
  if (s.includes("Forge error 404"))
    return "Forge API endpoint not found (404). Make sure Forge is running with --api enabled.";
  if (s.includes("Forge error 5") || s.includes("Forge error 4"))
    return `Forge returned an error: ${s.replace(/^.*Forge error \d+: /, "").slice(0, 120)}`;
  return s;
}

function buildFullPrompt(
  character: { triggerWord: string; baseDescription: string; artistTags: string },
  combo: { pose: string; outfit: string; expression: string; background: string; extras: string; loras: string[] }
) {
  return [
    character.triggerWord,
    character.baseDescription,
    character.artistTags ? `style of ${character.artistTags}` : "",
    combo.pose, combo.outfit, combo.expression, combo.background, combo.extras,
    ...combo.loras,
    "masterpiece, best quality, highres",
  ].filter((s) => s && s.trim()).join(", ");
}

function cartesian(arrays: string[][]): string[][] {
  return arrays.reduce<string[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ b64, onClose }: { b64: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "zoom-out",
      }}
    >
      <img
        src={`data:image/png;base64,${b64}`}
        style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: "4px", boxShadow: "0 0 60px rgba(0,0,0,0.8)" }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Image Card ────────────────────────────────────────────────────────────────
function ImageCard({ img, onApprove, onReject, onDelete, onLightbox }: {
  img: GeneratedImage;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onLightbox: (b64: string) => void;
}) {
  const [b64, setB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadImage = async () => {
    if (b64 || loading) return;
    setLoading(true);
    try {
      const data = await invoke<string>("read_image_b64", { path: img.path });
      setB64(data);
    } catch (e) { console.error("load image:", e); }
    setLoading(false);
  };

  const border = img.approved === true ? "2px solid var(--green)"
    : img.approved === false ? "2px solid var(--red)"
    : "1px solid var(--border)";

  return (
    <div style={{ background: "var(--bg-2)", borderRadius: "6px", border, overflow: "hidden", transition: "border 0.15s" }} onMouseEnter={loadImage}>
      {/* Image area */}
      <div style={{ aspectRatio: "1", background: "var(--bg-3)", position: "relative", cursor: b64 ? "zoom-in" : "default" }}
        onClick={() => b64 && onLightbox(b64)}>
        {b64
          ? <img src={`data:image/png;base64,${b64}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
              {loading ? "loading…" : "hover to load"}
            </div>
        }
        {/* Zoom hint */}
        {b64 && (
          <div style={{ position: "absolute", bottom: "6px", right: "6px", background: "rgba(0,0,0,0.5)", borderRadius: "3px", padding: "2px 4px", opacity: 0.7 }}>
            <ZoomIn size={11} color="white" />
          </div>
        )}
        {/* Approval badge */}
        {img.approved === true && <div style={{ position: "absolute", top: "6px", right: "6px", background: "var(--green)", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={11} color="white" strokeWidth={3} /></div>}
        {img.approved === false && <div style={{ position: "absolute", top: "6px", right: "6px", background: "var(--red)", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={11} color="white" strokeWidth={3} /></div>}
      </div>

      {/* Actions */}
      <div style={{ padding: "8px", display: "flex", gap: "6px" }}>
        <button onClick={onApprove} style={{ flex: 1, padding: "5px", fontSize: "11px", background: img.approved === true ? "var(--green)" : "var(--green-dim)", border: `1px solid var(--green)`, color: img.approved === true ? "white" : "var(--green)", borderRadius: "4px", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>✓</button>
        <button onClick={onReject} style={{ flex: 1, padding: "5px", fontSize: "11px", background: img.approved === false ? "var(--red)" : "var(--red-dim)", border: `1px solid var(--red)`, color: img.approved === false ? "white" : "#d47070", borderRadius: "4px", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>✗</button>
      </div>

      {/* Caption snippet */}
      <div style={{ padding: "0 8px 8px", fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
        {img.caption}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function BatchGenerator() {
  const { character, generation, images, addImage, updateImage, removeImage, settings } = useStore();
  const [status, setStatus] = useState<Status>("idle");
  const [currentJob, setCurrentJob] = useState("");
  const [queuePos, setQueuePos] = useState({ current: 0, total: 0 });
  const [lastError, setLastError] = useState("");
  const [lightboxB64, setLightboxB64] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState(220);
  const [genMode, setGenMode] = useState<"all" | "random">("all");
  const [randomN, setRandomN] = useState(10);
  const abortRef = useRef(false);

  const pending = images.filter((i) => i.approved === null);
  const approved = images.filter((i) => i.approved === true);
  const rejected = images.filter((i) => i.approved === false);

  const runGeneration = async (queue: Array<{ prompt: string; shotId: string; width: number; height: number }>) => {
    abortRef.current = false;
    setStatus("running");
    setLastError("");
    setQueuePos({ current: 0, total: queue.length });

    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break;
      const { prompt, shotId, width, height } = queue[i];
      setQueuePos({ current: i + 1, total: queue.length });
      setCurrentJob(prompt.split(",").slice(0, 4).join(", "));
      const seed = Math.floor(Math.random() * 2147483647);

      try {
        const result = await invoke<{ images: string[] }>("forge_txt2img", {
          baseUrl: settings.forgeUrl,
          params: {
            prompt,
            negative_prompt: "lowres, bad anatomy, bad hands, missing fingers, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, blurry",
            steps: 28,
            cfg_scale: 7.0,
            width,
            height,
            sampler_name: "DPM++ 2M Karras",
            seed,
            batch_size: 1,
            ...(character.baseModel ? { override_settings: { sd_model_checkpoint: character.baseModel } } : {}),
          },
        });

        const imageBytes = base64ToBytes(result.images[0]);
        const imageId = `${Date.now()}_${seed}`;
        const imagePath = `${character.outputDir}/${imageId}.png`;
        await invoke("save_image_bytes", { path: imagePath, data: Array.from(imageBytes) });
        const caption = deriveCaption(prompt, character.triggerWord);
        await invoke("save_caption", { imagePath, caption });
        addImage({ id: imageId, shotId, path: imagePath, prompt, caption, approved: null, seed, width, height });
      } catch (err) {
        setLastError(humanizeError(err));
        console.error("Generation error:", err);
      }
    }
    setStatus("done");
    setCurrentJob("");
  };

  const generateAll = async () => {
    if (!character.triggerWord) return setLastError("Set a trigger word on Character Setup first.");
    if (!character.outputDir) return setLastError("Set an output directory first.");

    const poseDim = generation.poses.length > 0 ? generation.poses : [""];
    const outfitDim = generation.outfits.length > 0 ? generation.outfits : [""];
    const exprDim = generation.expressions.length > 0 ? generation.expressions : [""];
    const bgDim = generation.backgrounds.length > 0 ? generation.backgrounds : [""];

    let combos = cartesian([poseDim, outfitDim, exprDim, bgDim]);

    if (genMode === "random" && combos.length > randomN) {
      for (let i = combos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combos[i], combos[j]] = [combos[j], combos[i]];
      }
      combos = combos.slice(0, randomN);
    }

    const queue = combos.flatMap(([pose, outfit, expression, background]) =>
      Array.from({ length: generation.count }, () => ({
        prompt: buildFullPrompt(character, { pose, outfit, expression, background, extras: generation.extras, loras: generation.loras }),
        shotId: `${pose}|${outfit}|${expression}|${background}`,
        width: generation.width,
        height: generation.height,
      }))
    );

    if (queue.length === 0) return setLastError("Add at least one variant on the Shot List page first.");
    await runGeneration(queue);
  };

  const requeueRejected = async () => {
    const toRequeue = images.filter((i) => i.approved === false);
    if (!toRequeue.length) return;
    const queue = toRequeue.map((img) => ({ prompt: img.prompt, shotId: img.shotId, width: img.width ?? 1024, height: img.height ?? 1024 }));
    toRequeue.forEach((img) => removeImage(img.id));
    await runGeneration(queue);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {lightboxB64 && <Lightbox b64={lightboxB64} onClose={() => setLightboxB64(null)} />}

      <PageHeader
        title="Batch Generator"
        subtitle="Send shot list to Forge WebUI and review results"
        actions={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {/* Thumbnail size slider */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", letterSpacing: "0.08em" }}>SIZE</span>
              <input type="range" min={160} max={400} step={20} value={thumbSize}
                onChange={(e) => setThumbSize(parseInt(e.target.value))}
                style={{ width: "80px", accentColor: "var(--accent)" }} />
            </div>
            {/* Generation mode */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              {(["all", "random"] as const).map((m) => (
                <button key={m} onClick={() => setGenMode(m)} style={{
                  padding: "4px 10px", fontSize: "10px",
                  background: genMode === m ? "var(--accent-glow)" : "var(--bg-3)",
                  border: `1px solid ${genMode === m ? "var(--accent-dim)" : "var(--border)"}`,
                  color: genMode === m ? "var(--accent-bright)" : "var(--text-muted)",
                  borderRadius: "3px", cursor: "pointer",
                  fontFamily: "var(--font-display)", fontWeight: 600,
                  letterSpacing: "0.05em", textTransform: "uppercase",
                }}>
                  {m === "all" ? "All Combos" : "Random"}
                </button>
              ))}
              {genMode === "random" && (
                <input
                  type="number" min={1} max={999} value={randomN}
                  onChange={(e) => setRandomN(Math.max(1, parseInt(e.target.value) || 10))}
                  style={{ width: "52px", padding: "4px 6px", fontSize: "11px", textAlign: "center" }}
                  title="Max combinations per shot"
                />
              )}
            </div>
            {rejected.length > 0 && status === "idle" && (
              <button className="btn-ghost" onClick={requeueRejected}>
                <RotateCcw size={12} style={{ display: "inline", marginRight: "5px" }} />
                Requeue {rejected.length}
              </button>
            )}
            {status === "running" ? (
              <button className="btn-danger" onClick={() => { abortRef.current = true; setStatus("idle"); }}>
                <Square size={12} style={{ display: "inline", marginRight: "5px" }} />Stop
              </button>
            ) : (
              <button className="btn-primary" onClick={generateAll}>
                <Play size={12} style={{ display: "inline", marginRight: "5px" }} />Generate All Shots
              </button>
            )}
          </div>
        }
      />

      {status === "running" && (
        <div style={{ padding: "10px 28px", background: "var(--accent-glow)", borderBottom: "1px solid var(--accent-dim)", display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-bright)", animation: "pulse 1s infinite" }} />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent-bright)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {queuePos.current} / {queuePos.total} · {currentJob}
          </div>
          <div style={{ width: "200px", height: "3px", background: "var(--bg-3)", borderRadius: "2px", overflow: "hidden", flexShrink: 0 }}>
            <div style={{ width: `${(queuePos.current / queuePos.total) * 100}%`, height: "100%", background: "var(--accent)", transition: "width 0.3s" }} />
          </div>
        </div>
      )}

      {lastError && (
        <div style={{ padding: "8px 28px", background: "var(--red-dim)", borderBottom: "1px solid var(--red)", fontFamily: "var(--font-mono)", fontSize: "11px", color: "#d47070", flexShrink: 0, display: "flex", justifyContent: "space-between" }}>
          <span>{lastError}</span>
          <button onClick={() => setLastError("")} style={{ background: "none", border: "none", color: "#d47070", cursor: "pointer", fontSize: "14px", padding: 0 }}>×</button>
        </div>
      )}

      <div style={{ display: "flex", gap: "1px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {[
          { label: "Pending", value: pending.length, color: "var(--text-secondary)" },
          { label: "Approved", value: approved.length, color: "var(--green)" },
          { label: "Rejected", value: rejected.length, color: "var(--red)" },
          { label: "Total", value: images.length, color: "var(--accent)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ flex: 1, padding: "10px 20px", background: "var(--bg-2)", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 800, color }}>{value}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
        {images.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "300px", gap: "12px" }}>
            <Zap size={32} color="var(--text-muted)" strokeWidth={1} />
            <div style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--text-muted)" }}>No images generated yet</div>
            <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "13px", color: "var(--text-muted)" }}>Add variants on the Shot List page, then hit Generate</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`, gap: "12px" }}>
            {images.map((img) => (
              <ImageCard key={img.id} img={img}
                onApprove={() => updateImage(img.id, { approved: true })}
                onReject={() => updateImage(img.id, { approved: false })}
                onDelete={() => removeImage(img.id)}
                onLightbox={setLightboxB64}
              />
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
