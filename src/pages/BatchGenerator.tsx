import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Square, RotateCcw, Check, X, Zap, ZoomIn, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore, GeneratedImage, OutfitEntry, PoseEntry } from "../store";
import { base64ToBytes, deriveCaption, normSeg } from "../lib/forge";


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
  character: { species: string; baseDescription: string; artistTags: string },
  combo: { pose: PoseEntry; outfit: OutfitEntry; expression: string; background: string; extras: string; loras: string[] },
  positiveEmbeddings: string[]
) {
  return [
    character.species,
    character.baseDescription,
    character.artistTags ? `style of ${character.artistTags}` : "",
    combo.pose.prompt,
    combo.outfit.triggerWord ?? "",
    combo.outfit.prompt,
    combo.expression, combo.background, combo.extras,
    ...combo.loras,
    ...(combo.pose.loras ?? []),
    ...(combo.outfit.loras ?? []),
    ...positiveEmbeddings,
    "masterpiece, best quality, highres",
  ].map((s) => normSeg(s)).filter((s) => s.length > 0).join(", ");
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

// ── Prompt Tooltip ────────────────────────────────────────────────────────────
function PromptTooltip({ prompt, x, y }: { prompt: string; x: number; y: number }) {
  return (
    <div style={{
      position: "fixed",
      left: x + 14,
      top: y + 14,
      zIndex: 2000,
      maxWidth: "420px",
      padding: "8px 12px",
      background: "rgba(10,10,14,0.95)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
      fontFamily: "var(--font-mono)",
      fontSize: "10px",
      color: "var(--text-secondary)",
      lineHeight: 1.6,
      pointerEvents: "none",
      wordBreak: "break-word",
    }}>
      {prompt}
    </div>
  );
}

// ── Preview Pane ──────────────────────────────────────────────────────────────
function PreviewPane({ img, onApprove, onReject, onDelete, onLightbox }: {
  img: GeneratedImage | null;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onLightbox: (b64: string) => void;
}) {
  const [b64, setB64] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!img) { setB64(null); return; }
    setB64(null);
    invoke<string>("read_image_b64", { path: img.path }).then(setB64).catch(() => {});
  }, [img?.id]);

  if (!img) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: "10px" }}>
        <ZoomIn size={28} color="var(--text-secondary)" strokeWidth={1} />
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)" }}>click an image to preview</div>
      </div>
    );
  }

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke("delete_image", { path: img.path });
      onDelete();
    } catch (e) {
      setDeleteError(`Delete failed: ${e}`);
      setDeleting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Image */}
      <div
        style={{ flex: 1, background: "var(--bg-3)", position: "relative", cursor: b64 ? "zoom-in" : "default", overflow: "hidden", minHeight: 0 }}
        onClick={() => b64 && onLightbox(b64)}
      >
        {b64
          ? <img src={`data:image/png;base64,${b64}`} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>loading…</div>
        }
        {b64 && (
          <div style={{ position: "absolute", bottom: "8px", right: "8px", background: "rgba(0,0,0,0.5)", borderRadius: "3px", padding: "3px 5px", opacity: 0.7 }}>
            <ZoomIn size={12} color="white" />
          </div>
        )}
        {/* Approval badge */}
        {img.approved === true && <div style={{ position: "absolute", top: "8px", right: "8px", background: "var(--green)", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={13} color="white" strokeWidth={3} /></div>}
        {img.approved === false && <div style={{ position: "absolute", top: "8px", right: "8px", background: "var(--red)", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} color="white" strokeWidth={3} /></div>}
      </div>

      {/* Caption */}
      <div style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)", lineHeight: 1.55, maxHeight: "90px", overflowY: "auto", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        {img.caption || <span style={{ opacity: 0.5 }}>no caption</span>}
      </div>

      {deleteError && (
        <div style={{ padding: "4px 14px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--red)", borderTop: "1px solid var(--border)" }}>{deleteError}</div>
      )}
      {/* Buttons */}
      <div style={{ padding: "10px 14px", display: "flex", gap: "8px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        <button onClick={onApprove} style={{ flex: 1, padding: "8px", fontSize: "13px", background: img.approved === true ? "var(--green)" : "var(--green-dim)", border: `1px solid var(--green)`, color: img.approved === true ? "white" : "var(--green)", borderRadius: "4px", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.05em" }}>✓ Approve</button>
        <button onClick={onReject} style={{ flex: 1, padding: "8px", fontSize: "13px", background: img.approved === false ? "var(--red)" : "var(--red-dim)", border: `1px solid var(--red)`, color: img.approved === false ? "white" : "var(--red-bright)", borderRadius: "4px", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.05em" }}>✗ Reject</button>
        <button onClick={handleDelete} disabled={deleting} style={{ padding: "8px 10px", fontSize: "13px", background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "4px", cursor: "pointer" }} title="Delete from disk">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Image Card ────────────────────────────────────────────────────────────────
function ImageCard({ img, selected, focused, onSelect, onFocus, onApprove, onReject, onDelete, onPromptHover, onPromptLeave }: {
  img: GeneratedImage;
  selected?: boolean;
  focused?: boolean;
  onSelect?: (shiftKey: boolean) => void;
  onFocus: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onPromptHover: (prompt: string, x: number, y: number) => void;
  onPromptLeave: () => void;
}) {
  const [b64, setB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => () => onPromptLeave(), []);

  const loadImage = async () => {
    if (b64 || loading) return;
    setLoading(true);
    try {
      const data = await invoke<string>("read_image_b64", { path: img.path });
      setB64(data);
    } catch (e) { console.error("load image:", e); }
    setLoading(false);
  };

  useEffect(() => { loadImage(); }, [img.path]);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke("delete_image", { path: img.path });
      onDelete();
    } catch (e) {
      setDeleteError(`${e}`);
      setDeleting(false);
    }
  };

  const border = selected ? "2px solid var(--accent)"
    : focused ? "2px solid var(--text-secondary)"
    : img.approved === true ? "2px solid var(--green)"
    : img.approved === false ? "2px solid var(--red)"
    : "1px solid var(--border)";

  return (
    <div
      onClick={(e) => { if ((e.ctrlKey || e.metaKey || e.shiftKey) && onSelect) { e.stopPropagation(); onSelect(e.shiftKey); } }}
      onMouseMove={(e) => onPromptHover(img.prompt, e.clientX, e.clientY)}
      onMouseLeave={onPromptLeave}
      style={{ background: "var(--bg-2)", borderRadius: "6px", border, overflow: "hidden", transition: "border 0.15s", cursor: "default" }}
    >
      {/* Image area */}
      <div style={{ aspectRatio: "1", background: "var(--bg-3)", position: "relative", cursor: "pointer" }}
        onClick={(e) => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey) onFocus(); }}>
        {b64
          ? <img src={`data:image/png;base64,${b64}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
              {loading ? "loading…" : ""}
            </div>
        }
        {/* Selection checkbox */}
        {onSelect && (
          <div
            onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey); }}
            style={{ position: "absolute", top: "6px", left: "6px", width: "16px", height: "16px", borderRadius: "3px", background: selected ? "var(--accent)" : "rgba(0,0,0,0.45)", border: `1px solid ${selected ? "var(--accent)" : "rgba(255,255,255,0.25)"}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            {selected && <Check size={10} color="white" strokeWidth={3} />}
          </div>
        )}
        {/* Approval badge */}
        {img.approved === true && <div style={{ position: "absolute", top: "6px", right: "6px", background: "var(--green)", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={11} color="white" strokeWidth={3} /></div>}
        {img.approved === false && <div style={{ position: "absolute", top: "6px", right: "6px", background: "var(--red)", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={11} color="white" strokeWidth={3} /></div>}
      </div>

      {/* Actions */}
      <div style={{ padding: "8px", display: "flex", gap: "6px" }}>
        <button onClick={onApprove} style={{ flex: 1, padding: "5px", fontSize: "11px", background: img.approved === true ? "var(--green)" : "var(--green-dim)", border: `1px solid var(--green)`, color: img.approved === true ? "white" : "var(--green)", borderRadius: "4px", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>✓</button>
        <button onClick={onReject} style={{ flex: 1, padding: "5px", fontSize: "11px", background: img.approved === false ? "var(--red)" : "var(--red-dim)", border: `1px solid var(--red)`, color: img.approved === false ? "white" : "var(--red-bright)", borderRadius: "4px", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>✗</button>
        <button onClick={handleDelete} disabled={deleting} style={{ padding: "5px 7px", fontSize: "11px", background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "4px", cursor: "pointer" }} title="Delete from disk">
          <Trash2 size={11} />
        </button>
      </div>

      {/* Caption snippet / delete error */}
      <div style={{ padding: "0 8px 8px", fontFamily: "var(--font-mono)", fontSize: "9px", color: deleteError ? "var(--red)" : "var(--text-muted)", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
        {deleteError ?? img.caption}
      </div>
    </div>
  );
}

// Module-level refs — survive component unmount/remount
const abortRef = { current: false };
// Points to the live queue array during generation so onReject can append to it
const liveQueueRef = { current: null as Array<{ prompt: string; shotId: string; width: number; height: number; sourceImageId?: string; sourceImagePath?: string }> | null };

// ── Main Component ────────────────────────────────────────────────────────────
export default function BatchGenerator() {
  const { character, generation, updateGeneration, images, addImage, updateImage, removeImage, clearImages, settings, generationRunning, setGenerationRunning, generationProgress, setGenerationProgress, generationCurrentJob, setGenerationCurrentJob } = useStore();
  const [lastError, setLastError] = useState("");
  const [lightboxB64, setLightboxB64] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState(220);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmLargeQueue, setConfirmLargeQueue] = useState(false);
  const [largeQueueSize, setLargeQueueSize] = useState(0);
  const pendingLargeQueue = useRef<typeof liveQueueRef.current>(null);
  const [purgeFailCount, setPurgeFailCount] = useState(0);
  const [approvedExpanded, setApprovedExpanded] = useState(false);
  const [autoRequeue, setAutoRequeue] = useState(false);
  const [tooltip, setTooltip] = useState<{ prompt: string; x: number; y: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [imageProgress, setImageProgress] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedImg = images.find((i) => i.id === focusedId) ?? null;

  const ezMode = settings.ezMode ?? false;

  useEffect(() => {
    if (ezMode) {
      setAutoRequeue(true);
      updateGeneration({ genMode: "all" });
    }
  }, [ezMode]);

  const anyConfirm = confirmPurge || confirmGenerate || confirmLargeQueue;
  const pending = images.filter((i) => i.approved === null);
  const approved = images.filter((i) => i.approved === true);
  const rejected = images.filter((i) => i.approved === false);

  const runGeneration = async (queue: Array<{ prompt: string; shotId: string; width: number; height: number; sourceImageId?: string; sourceImagePath?: string }>) => {
    abortRef.current = false;
    liveQueueRef.current = queue;
    setGenerationRunning(true);
    setLastError("");
    setGenerationProgress(0, queue.length);
    await new Promise((r) => setTimeout(r, 0)); // flush React paint before loop

    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break;
      const { prompt, shotId, width, height, sourceImageId, sourceImagePath } = queue[i];
      setGenerationProgress(i + 1, queue.length); // queue.length re-evaluated each iteration
      setGenerationCurrentJob(prompt);
      const seed = Math.floor(Math.random() * 2147483647);

      try {
        const progressPoll = setInterval(async () => {
          try {
            const p = await invoke<{ progress: number }>("forge_get_progress", { baseUrl: settings.forgeUrl });
            setImageProgress(Math.min(1, p.progress ?? 0));
          } catch {}
        }, 800);

        try {
          const result = await invoke<{ images: string[] }>("forge_txt2img", {
            baseUrl: settings.forgeUrl,
            params: {
              prompt,
              negative_prompt: ["lowres, bad anatomy, bad hands, missing fingers, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, blurry", ...generation.negativeEmbeddings].join(", "),
              steps: generation.steps,
              cfg_scale: generation.cfgScale,
              width,
              height,
              sampler_name: generation.samplerName,
              scheduler: generation.scheduler || undefined,
              seed,
              batch_size: 1,
              ...(character.baseModel ? { override_settings: { sd_model_checkpoint: character.baseModel }, override_settings_restore_afterwards: false } : {}),
            },
          });

          const imageBytes = base64ToBytes(result.images[0]);
          const imageId = `${Date.now()}_${seed}`;
          const imagePath = `${character.outputDir}/${imageId}.png`;
          await invoke("save_image_bytes", { path: imagePath, data: Array.from(imageBytes) });
          const caption = deriveCaption(prompt, character.triggerWord, {
            species: character.species,
            baseDescription: character.baseDescription,
            artistTags: character.artistTags,
          });
          await invoke("save_caption", { imagePath, caption });
          addImage({ id: imageId, shotId, path: imagePath, prompt, caption, approved: null, seed, width, height });
          // If this was a requeue, delete the old file and remove it from store now that replacement succeeded
          if (sourceImageId && sourceImagePath) {
            try { await invoke("delete_image", { path: sourceImagePath }); } catch (e) { console.error("requeue: failed to delete old image:", e); }
            removeImage(sourceImageId);
            setSelectedIds((prev) => { const n = new Set(prev); n.delete(sourceImageId); return n; });
          }
        } finally {
          clearInterval(progressPoll);
          setImageProgress(0);
        }
      } catch (err) {
        setLastError(humanizeError(err));
        console.error("Generation error:", err);
      }
    }
    liveQueueRef.current = null;
    setGenerationRunning(false);
    setGenerationCurrentJob("");
  };

  const generateAll = async () => {
    if (!character.triggerWord) return setLastError("Set a trigger word on Character Setup first.");
    if (!character.outputDir) return setLastError("Set an output directory first.");

    const poseDim: PoseEntry[] = generation.poses.length > 0 ? generation.poses : [{ prompt: "" }];
    const outfitDim: OutfitEntry[] = generation.outfits.length > 0 ? generation.outfits : [{ prompt: "" }];
    const exprDim = generation.expressions.length > 0 ? generation.expressions : [""];
    const bgDim = generation.backgrounds.length > 0 ? generation.backgrounds : [""];

    // Cartesian of string dims, then combine with PoseEntry/OutfitEntry dims
    const stringCombos = cartesian([exprDim, bgDim]);
    type Combo = [PoseEntry, OutfitEntry, string, string];
    let combos: Combo[] = stringCombos.flatMap(([expression, background]) =>
      poseDim.flatMap((pose) =>
        outfitDim.map((outfit) => [pose, outfit, expression, background] as Combo)
      )
    );

    if (generation.genMode === "random") {
      for (let i = combos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combos[i], combos[j]] = [combos[j], combos[i]];
      }
      combos = combos.slice(0, generation.randomCount);
    }

    const queue = combos.flatMap(([pose, outfit, expression, background]) =>
      Array.from({ length: generation.count }, () => ({
        prompt: buildFullPrompt(character, { pose, outfit, expression, background, extras: generation.extras, loras: generation.loras }, generation.positiveEmbeddings),
        shotId: `${pose.prompt}|${outfit.prompt}|${expression}|${background}`,
        width: generation.width,
        height: generation.height,
      }))
    );

    if (queue.length === 0) return setLastError("Add at least one variant on the Shot List page first.");
    if (!generation.width || !generation.height || generation.width % 8 !== 0 || generation.height % 8 !== 0)
      return setLastError(`Invalid dimensions ${generation.width}×${generation.height} — must be non-zero and divisible by 8. Fix in Sampler settings.`);
    if (queue.length > 50 && !pendingLargeQueue.current) {
      pendingLargeQueue.current = queue;
      setLargeQueueSize(queue.length);
      setConfirmLargeQueue(true);
      return;
    }
    pendingLargeQueue.current = null;
    await runGeneration(queue);
  };

  const requeueRejected = async () => {
    const toRequeue = images.filter((i) => i.approved === false);
    if (!toRequeue.length) return;
    const queue = toRequeue.map((img) => ({
      prompt: img.prompt,
      shotId: img.shotId,
      width: img.width ?? 1024,
      height: img.height ?? 1024,
      sourceImageId: img.id,
      sourceImagePath: img.path,
    }));
    await runGeneration(queue);
  };

  const purgeDirectory = async (): Promise<number> => {
    let failures = 0;
    // Delete all store-tracked images
    for (const img of images) {
      try { await invoke("delete_image", { path: img.path }); } catch { failures++; }
    }
    // Also sweep the output directory for any orphaned images not in the store
    if (character.outputDir) {
      try {
        const remaining = await invoke<string[]>("list_images_in_dir", { dir: character.outputDir });
        for (const p of remaining) {
          try { await invoke("delete_image", { path: p }); } catch { failures++; }
        }
      } catch {}
    }
    clearImages();
    return failures;
  };

  const purgeAll = async () => {
    const failures = await purgeDirectory();
    setConfirmPurge(false);
    if (failures > 0) setPurgeFailCount(failures);
  };

  const handleGenerateClick = () => {
    if (images.length > 0) {
      setConfirmGenerate(true);
    } else {
      generateAll();
    }
  };

  const purgeAndGenerate = async () => {
    setConfirmGenerate(false);
    const failures = await purgeDirectory();
    if (failures > 0) setPurgeFailCount(failures);
    generateAll();
  };

  const displayedGrid = [...pending, ...rejected];

  const handleSelect = (id: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedId) {
        const fromIdx = displayedGrid.findIndex((img) => img.id === lastSelectedId);
        const toIdx = displayedGrid.findIndex((img) => img.id === id);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          for (let i = start; i <= end; i++) next.add(displayedGrid[i].id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (!shiftKey) setLastSelectedId(id);
  };

  const bulkApprove = () => {
    selectedIds.forEach((id) => updateImage(id, { approved: true }));
    setSelectedIds(new Set());
  };

  const bulkReject = () => {
    selectedIds.forEach((id) => updateImage(id, { approved: false }));
    setSelectedIds(new Set());
  };

  const getNextPendingId = (currentId: string): string | null => {
    const grid = [...images.filter(i => i.approved === null), ...images.filter(i => i.approved === false)];
    const currentIdx = grid.findIndex(i => i.id === currentId);
    for (let i = currentIdx + 1; i < grid.length; i++) {
      if (grid[i].approved === null) return grid[i].id;
    }
    for (let i = 0; i < currentIdx; i++) {
      if (grid[i].approved === null) return grid[i].id;
    }
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {lightboxB64 && <Lightbox b64={lightboxB64} onClose={() => setLightboxB64(null)} />}
      {tooltip && <PromptTooltip prompt={tooltip.prompt} x={tooltip.x} y={tooltip.y} />}

      <PageHeader
        title="Batch Generator"
        subtitle="Send shot list to Forge WebUI and review results"
        actions={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {/* Thumbnail size slider */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.08em" }}>SIZE</span>
              <input type="range" min={160} max={400} step={20} value={thumbSize}
                onChange={(e) => setThumbSize(parseInt(e.target.value))}
                style={{ width: "80px", accentColor: "var(--accent)" }} />
            </div>
            {/* Generation mode */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px", opacity: ezMode ? 0.4 : 1, pointerEvents: ezMode ? "none" : "auto" }}>
              {(["all", "random"] as const).map((m) => (
                <button key={m} onClick={() => updateGeneration({ genMode: m })} style={{
                  padding: "4px 10px", fontSize: "10px",
                  background: generation.genMode === m ? "var(--accent-glow)" : "var(--bg-3)",
                  border: `1px solid ${generation.genMode === m ? "var(--accent-dim)" : "var(--border)"}`,
                  color: generation.genMode === m ? "var(--accent-bright)" : "var(--text-muted)",
                  borderRadius: "3px", cursor: "pointer",
                  fontFamily: "var(--font-display)", fontWeight: 600,
                  letterSpacing: "0.05em", textTransform: "uppercase",
                }}>
                  {m === "all" ? "All Combos" : "Random"}
                </button>
              ))}
              {generation.genMode === "random" && (
                <input
                  type="number" min={1} max={999} value={generation.randomCount}
                  onChange={(e) => updateGeneration({ randomCount: Math.max(1, parseInt(e.target.value) || 10) })}
                  style={{ width: "52px", padding: "4px 6px", fontSize: "11px", textAlign: "center" }}
                  title="Max combinations per shot"
                />
              )}
            </div>
            {/* Auto-requeue toggle */}
            <button
              onClick={() => setAutoRequeue(!autoRequeue)}
              disabled={ezMode}
              style={{
                padding: "4px 10px", fontSize: "10px",
                background: autoRequeue ? "rgba(74,154,106,0.15)" : "var(--bg-3)",
                border: `1px solid ${autoRequeue ? "var(--green)" : "var(--border)"}`,
                color: autoRequeue ? "var(--green)" : "var(--text-muted)",
                borderRadius: "3px", cursor: ezMode ? "default" : "pointer",
                fontFamily: "var(--font-display)", fontWeight: 600,
                letterSpacing: "0.05em", textTransform: "uppercase",
                opacity: ezMode ? 0.4 : 1,
              }}
              title="Automatically requeue rejected images while generation is running"
            >
              <RotateCcw size={10} style={{ display: "inline", marginRight: "4px" }} />
              Auto-requeue
            </button>

            {selectedIds.size > 0 && (
              <>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--accent-bright)" }}>{selectedIds.size} selected</span>
                <button className="btn-ghost" onClick={bulkApprove} style={{ padding: "4px 10px", fontSize: "10px", color: "var(--green)", borderColor: "var(--green)" }}>✓ Approve all</button>
                <button className="btn-ghost" onClick={bulkReject} style={{ padding: "4px 10px", fontSize: "10px", color: "var(--red)", borderColor: "var(--red)" }}>✗ Reject all</button>
                <button className="btn-ghost" onClick={() => setSelectedIds(new Set())} style={{ padding: "4px 10px", fontSize: "10px" }}>Clear</button>
              </>
            )}
            {images.length > 0 && !generationRunning && !ezMode && (
              <button className="btn-danger" disabled={anyConfirm} onClick={() => setConfirmPurge(true)} style={{ opacity: anyConfirm ? 0.4 : 0.8 }}>
                <Trash2 size={12} style={{ display: "inline", marginRight: "5px" }} />
                Purge
              </button>
            )}
            {rejected.length > 0 && !generationRunning && (
              <button className="btn-primary" disabled={anyConfirm} onClick={requeueRejected}>
                <RotateCcw size={12} style={{ display: "inline", marginRight: "5px" }} />
                Requeue {rejected.length}
              </button>
            )}
            {generationRunning ? (
              <button className="btn-danger" disabled={anyConfirm} onClick={() => { abortRef.current = true; }}>
                <Square size={12} style={{ display: "inline", marginRight: "5px" }} />Stop
              </button>
            ) : (
              <button className="btn-primary" disabled={anyConfirm} onClick={handleGenerateClick}>
                <Play size={12} style={{ display: "inline", marginRight: "5px" }} />Generate All Shots
              </button>
            )}
          </div>
        }
      />

      {generationRunning && (
        <div style={{ padding: "8px 28px", background: "var(--accent-glow)", borderBottom: "1px solid var(--accent-dim)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "5px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-bright)", animation: "pulse 1s infinite", flexShrink: 0 }} />
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent-bright)", flex: 1 }}>
              {generationProgress.current} / {generationProgress.total}
            </div>
            <div style={{ width: "200px", height: "3px", background: "var(--bg-3)", borderRadius: "2px", overflow: "hidden", flexShrink: 0 }}>
              <div style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%`, height: "100%", background: "var(--accent)", transition: "width 0.3s" }} />
            </div>
          </div>
          {imageProgress > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingLeft: "24px", marginBottom: "4px" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--accent-bright)", opacity: 0.6, flexShrink: 0 }}>image</span>
              <div style={{ width: "200px", height: "2px", background: "var(--bg-3)", borderRadius: "1px", overflow: "hidden", flexShrink: 0 }}>
                <div style={{ width: `${imageProgress * 100}%`, height: "100%", background: "var(--accent-bright)", transition: "width 0.6s" }} />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--accent-bright)", opacity: 0.6 }}>{Math.round(imageProgress * 100)}%</span>
            </div>
          )}
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--accent-bright)", opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: "24px" }}>
            {generationCurrentJob}
          </div>
        </div>
      )}

      {lastError && (
        <div style={{ padding: "8px 28px", background: "var(--red-dim)", borderBottom: "1px solid var(--red)", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--red-bright)", flexShrink: 0, display: "flex", justifyContent: "space-between" }}>
          <span>{lastError}</span>
          <button onClick={() => setLastError("")} style={{ background: "none", border: "none", color: "var(--red-bright)", cursor: "pointer", fontSize: "14px", padding: 0 }}>×</button>
        </div>
      )}

      {confirmGenerate && (
        <div style={{ padding: "12px 28px", background: "var(--accent-glow)", borderBottom: "1px solid var(--accent-dim)", flexShrink: 0, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent-bright)", flex: 1, minWidth: "200px" }}>
            {images.length} image{images.length !== 1 ? "s" : ""} already exist. "Purge &amp; redo" will also flush the output directory.
          </span>
          <button onClick={() => { setConfirmGenerate(false); generateAll(); }} style={{
            padding: "5px 14px", fontSize: "11px", cursor: "pointer",
            background: "var(--accent-glow)", border: "1px solid var(--accent-dim)",
            color: "var(--accent-bright)", borderRadius: "4px",
            fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap",
          }}>Continue (add more)</button>
          <button onClick={purgeAndGenerate} style={{
            padding: "5px 14px", fontSize: "11px", cursor: "pointer",
            background: "var(--red)", border: "none", color: "white",
            borderRadius: "4px", fontFamily: "var(--font-display)", fontWeight: 700,
            letterSpacing: "0.04em", whiteSpace: "nowrap",
          }}>Purge &amp; redo</button>
          <button onClick={() => setConfirmGenerate(false)} style={{
            padding: "5px 14px", fontSize: "11px", cursor: "pointer",
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text-muted)", borderRadius: "4px",
            fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em",
          }}>Cancel</button>
        </div>
      )}

      {confirmLargeQueue && (
        <div style={{ padding: "12px 28px", background: "var(--accent-glow)", borderBottom: "1px solid var(--accent-dim)", flexShrink: 0, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent-bright)", flex: 1, minWidth: "200px" }}>
            {largeQueueSize} images queued — that's a large batch. LoRAs typically train well on 20–50 images.
          </span>
          <button onClick={async () => { setConfirmLargeQueue(false); const q = pendingLargeQueue.current; pendingLargeQueue.current = null; if (q) await runGeneration(q); }} style={{
            padding: "5px 14px", fontSize: "11px", cursor: "pointer",
            background: "var(--accent-glow)", border: "1px solid var(--accent-dim)",
            color: "var(--accent-bright)", borderRadius: "4px",
            fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap",
          }}>Generate anyway</button>
          <button onClick={() => { setConfirmLargeQueue(false); pendingLargeQueue.current = null; }} style={{
            padding: "5px 14px", fontSize: "11px", cursor: "pointer",
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text-muted)", borderRadius: "4px",
            fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em",
          }}>Cancel</button>
        </div>
      )}

      {confirmPurge && (
        <div style={{ padding: "10px 28px", background: "rgba(154,74,74,0.12)", borderBottom: "1px solid var(--red)", flexShrink: 0, display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--red-bright)", flex: 1 }}>
            This will permanently delete all images and caption files from the output directory — including any not tracked in this session. This cannot be undone.
          </span>
          <button onClick={purgeAll} style={{
            padding: "5px 14px", fontSize: "11px", cursor: "pointer",
            background: "var(--red)", border: "none", color: "white",
            borderRadius: "4px", fontFamily: "var(--font-display)", fontWeight: 700,
            letterSpacing: "0.05em", textTransform: "uppercase",
          }}>Delete all</button>
          <button onClick={() => setConfirmPurge(false)} style={{
            padding: "5px 14px", fontSize: "11px", cursor: "pointer",
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text-muted)", borderRadius: "4px",
            fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em",
          }}>Cancel</button>
        </div>
      )}

      {purgeFailCount > 0 && (
        <div style={{ padding: "6px 20px", background: "rgba(154,74,74,0.12)", borderBottom: "1px solid var(--red)", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--red-bright)", flex: 1 }}>
            {purgeFailCount} file{purgeFailCount > 1 ? "s" : ""} could not be deleted from disk — they may have already been removed.
          </span>
          <button onClick={() => setPurgeFailCount(0)} style={{ padding: "2px 8px", fontSize: "10px", cursor: "pointer", background: "transparent", border: "1px solid var(--red)", color: "var(--red-bright)", borderRadius: "4px", fontFamily: "var(--font-display)" }}>Dismiss</button>
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
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 16px 20px 28px" }}>
        {/* Pending + rejected grid */}
        {[...pending, ...rejected].length === 0 && approved.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "300px", gap: "12px" }}>
            <Zap size={32} color="var(--text-secondary)" strokeWidth={1} />
            <div style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--text-secondary)" }}>No images generated yet</div>
            <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "13px", color: "var(--text-secondary)" }}>Add variants on the Shot List page, then hit Generate</div>
          </div>
        ) : (
          <>
            {displayedGrid.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`, gap: "12px" }}>
                {displayedGrid.map((img) => (
                  <ImageCard key={img.id} img={img}
                    selected={selectedIds.has(img.id)}
                    focused={focusedId === img.id}
                    onSelect={(shiftKey) => handleSelect(img.id, shiftKey)}
                    onFocus={() => setFocusedId(img.id)}
                    onApprove={() => {
                      if (selectedIds.has(img.id)) { bulkApprove(); return; }
                      updateImage(img.id, { approved: true });
                    }}
                    onReject={() => {
                      if (selectedIds.has(img.id)) { bulkReject(); return; }
                      updateImage(img.id, { approved: false });
                      if (autoRequeue && img.approved !== false) {
                        const job = { prompt: img.prompt, shotId: img.shotId, width: img.width ?? generation.width, height: img.height ?? generation.height, sourceImageId: img.id, sourceImagePath: img.path };
                        if (liveQueueRef.current) {
                          liveQueueRef.current.push(job);
                        } else {
                          runGeneration([job]);
                        }
                      }
                    }}
                    onDelete={() => { removeImage(img.id); if (focusedId === img.id) setFocusedId(null); }}
                    onPromptHover={(prompt, x, y) => setTooltip({ prompt, x, y })}
                    onPromptLeave={() => setTooltip(null)}
                  />
                ))}
              </div>
            )}

            {/* Approved collapsible section */}
            {approved.length > 0 && (
              <div style={{ borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden", marginTop: [...pending, ...rejected].length > 0 ? "20px" : "0" }}>
                <div
                  onClick={() => setApprovedExpanded(!approvedExpanded)}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "10px 16px", cursor: "pointer",
                    background: "var(--bg-2)", userSelect: "none",
                  }}
                >
                  <Check size={13} color="var(--green)" strokeWidth={2.5} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--green)", fontWeight: 700 }}>
                    {approved.length} Approved
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)", flex: 1 }}>
                    — ready for captioning
                  </span>
                  {approvedExpanded
                    ? <ChevronUp size={13} color="var(--text-muted)" />
                    : <ChevronDown size={13} color="var(--text-muted)" />}
                </div>
                {approvedExpanded && (
                  <div style={{ padding: "12px 16px", background: "var(--bg-1)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(120, thumbSize - 60)}px, 1fr))`, gap: "8px" }}>
                      {approved.map((img) => (
                        <ImageCard key={img.id} img={img}
                          focused={focusedId === img.id}
                          onFocus={() => setFocusedId(img.id)}
                          onApprove={() => updateImage(img.id, { approved: true })}
                          onReject={() => {
                            updateImage(img.id, { approved: false });
                            if (autoRequeue) {
                              const job = { prompt: img.prompt, shotId: img.shotId, width: img.width ?? generation.width, height: img.height ?? generation.height, sourceImageId: img.id, sourceImagePath: img.path };
                              if (liveQueueRef.current) {
                                liveQueueRef.current.push(job);
                              } else {
                                runGeneration([job]);
                              }
                            }
                          }}
                          onDelete={() => { removeImage(img.id); if (focusedId === img.id) setFocusedId(null); }}
                          onPromptHover={(prompt, x, y) => setTooltip({ prompt, x, y })}
                          onPromptLeave={() => setTooltip(null)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Preview pane */}
      <div style={{ flex: "0 0 30%", minWidth: "260px", maxWidth: "520px", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <PreviewPane
          img={focusedImg}
          onApprove={() => {
            if (!focusedImg) return;
            const next = getNextPendingId(focusedImg.id);
            updateImage(focusedImg.id, { approved: true });
            setFocusedId(next);
          }}
          onReject={() => {
            if (!focusedImg) return;
            const next = getNextPendingId(focusedImg.id);
            updateImage(focusedImg.id, { approved: false });
            setFocusedId(next);
            if (autoRequeue) {
              const job = { prompt: focusedImg.prompt, shotId: focusedImg.shotId, width: focusedImg.width ?? generation.width, height: focusedImg.height ?? generation.height, sourceImageId: focusedImg.id, sourceImagePath: focusedImg.path };
              if (liveQueueRef.current) liveQueueRef.current.push(job); else runGeneration([job]);
            }
          }}
          onDelete={() => { if (focusedImg) { removeImage(focusedImg.id); setFocusedId(null); } }}
          onLightbox={setLightboxB64}
        />
      </div>

      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
