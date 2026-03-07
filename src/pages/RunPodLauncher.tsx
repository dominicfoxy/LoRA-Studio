import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Server, Upload, Play, Square, RefreshCw, Terminal, AlertTriangle } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore } from "../store";
import {
  listGpuTypes, createPod, getPod, terminatePod, listPods,
  RECOMMENDED_GPUS, KOHYA_POD_TEMPLATE, generateKohyaConfig,
  Pod,
} from "../lib/runpod";

interface TrainingConfig {
  gpuTypeId: string;
  cloudType: "SECURE" | "COMMUNITY";
  steps: number;
  learningRate: string;
  networkDim: number;
  resolution: number;
}

const DEFAULT_CONFIG: TrainingConfig = {
  gpuTypeId: "NVIDIA A100-SXM4-40GB",
  cloudType: "SECURE",
  steps: 2000,
  learningRate: "1e-4",
  networkDim: 32,
  resolution: 1024,
};

type Phase = "config" | "packaging" | "uploading" | "training" | "done";

export default function RunPodLauncher() {
  const { character, images, settings } = useStore();
  const [config, setConfig] = useState<TrainingConfig>(DEFAULT_CONFIG);
  const [phase, setPhase] = useState<Phase>("config");
  const [logs, setLogs] = useState<string[]>([]);
  const [pod, setPod] = useState<Pod | null>(null);
  const [zipPath, setZipPath] = useState("");
  const [activePods, setActivePods] = useState<Pod[]>([]);
  const [polling, setPolling] = useState(false);
  const [confirmLowImages, setConfirmLowImages] = useState(false);
  const [livePrices, setLivePrices] = useState<Record<string, { secure: number; community: number }> | null>(null);
  const [fetchingPrices, setFetchingPrices] = useState(false);

  const approved = images.filter((i) => i.approved === true);
  const hasApiKey = !!settings.runpodApiKey;

  const estimatedTime = (() => {
    const gpu = RECOMMENDED_GPUS.find((g) => g.id === config.gpuTypeId);
    if (!gpu) return null;
    // Resolution scaling: throughput roughly proportional to (1024/res)^1.5
    const resFactor = Math.pow(1024 / config.resolution, 1.5);
    const sps = gpu.stepsPerSec * resFactor;
    const seconds = config.steps / sps;
    if (seconds < 60) return `~${Math.round(seconds)}s`;
    if (seconds < 3600) return `~${Math.round(seconds / 60)}min`;
    return `~${(seconds / 3600).toFixed(1)}hr`;
  })();

  const log = (msg: string) => setLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const packageDataset = async () => {
    if (!character.outputDir) { log("Error: Set an output directory first."); return; }
    if (approved.length < 10 && !confirmLowImages) {
      setConfirmLowImages(true);
      return;
    }

    setConfirmLowImages(false);
    setPhase("packaging");
    log(`Packaging ${approved.length} approved images...`);

    try {
      const zipOut = `${character.outputDir}/${character.triggerWord}_dataset.zip`;
      await invoke("zip_dataset", { datasetDir: character.outputDir, outputZip: zipOut });
      setZipPath(zipOut);
      log(`Dataset zipped → ${zipOut}`);

      // Generate Kohya config
      const kohyaConf = generateKohyaConfig({
        triggerWord: character.triggerWord,
        datasetDir: `/workspace/dataset`,
        outputDir: `/workspace/output`,
        baseModel: `/workspace/models/${character.baseModel || "model.safetensors"}`,
        steps: config.steps,
        learningRate: config.learningRate,
        networkDim: config.networkDim,
        resolution: config.resolution,
      });

      const confPath = `${character.outputDir}/kohya_config.toml`;
      await invoke("save_project", { path: confPath, data: kohyaConf });
      log(`Kohya config saved → ${confPath}`);
      setPhase("uploading");
    } catch (err) {
      log(`ERROR: ${err}`);
      setPhase("config");
    }
  };

  const launchPod = async () => {
    if (!hasApiKey) { log("Error: Add your RunPod API key in Settings."); return; }
    if (!zipPath) { log("Error: Package dataset first."); return; }

    setPhase("training");
    log("Launching RunPod pod...");

    try {
      const newPod = await createPod(settings.runpodApiKey, {
        name: `lora-${character.triggerWord}-${Date.now()}`,
        ...KOHYA_POD_TEMPLATE,
        gpuTypeId: config.gpuTypeId,
        cloudType: config.cloudType,
        env: [
          { key: "JUPYTER_PASSWORD", value: "lorastudio" },
        ],
      });
      setPod(newPod);
      log(`Pod created: ${newPod.id} (${newPod.status})`);
      log(`Cost: ~$${newPod.costPerHr?.toFixed(2) ?? "?"} USD/hr`);
      log("");
      log("Next steps:");
      log("1. Wait for pod status → RUNNING (click Refresh)");
      log("2. Open Jupyter in your browser via the pod URL");
      log("3. Upload your dataset zip and kohya_config.toml");
      log("4. Run: python train_network.py --config_file kohya_config.toml");
      log("");
      log("Or use the SSH command once the pod is running.");
      startPolling(newPod.id);
    } catch (err) {
      log(`Launch ERROR: ${err}`);
      setPhase("uploading");
    }
  };

  const startPolling = (podId: string) => {
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const updated = await getPod(settings.runpodApiKey, podId);
        setPod(updated);
        if (updated.status === "RUNNING") {
          log(`Pod RUNNING — uptime: ${updated.runtime?.uptimeInSeconds ?? 0}s`);
          const ports = updated.runtime?.ports;
          if (ports) {
            const jupyter = ports.find((p) => p.privatePort === 8888);
            if (jupyter) log(`Jupyter: http://${jupyter.ip}:${jupyter.publicPort}`);
          }
        }
      } catch {}
    }, 15000);
    setTimeout(() => { clearInterval(interval); setPolling(false); }, 1800000); // 30min max
  };

  const terminateCurrentPod = async () => {
    if (!pod) return;
    
    try {
      await terminatePod(settings.runpodApiKey, pod.id);
      log(`Pod ${pod.id} terminated.`);
      setPod(null);
      setPhase("done");
    } catch (err) {
      log(`Terminate error: ${err}`);
    }
  };

  const refreshPods = async () => {
    if (!hasApiKey) return;
    try {
      const pods = await listPods(settings.runpodApiKey);
      setActivePods(pods);
    } catch (err) {
      log(`List pods error: ${err}`);
    }
  };

  const fetchPrices = async () => {
    if (!hasApiKey) { log("Add your RunPod API key in Settings first."); return; }
    setFetchingPrices(true);
    try {
      const gpuTypes = await listGpuTypes(settings.runpodApiKey);
      const map: Record<string, { secure: number; community: number }> = {};
      for (const g of gpuTypes) {
        map[g.id] = {
          secure: g.lowestPrice?.uninterruptablePrice ?? 0,
          community: g.lowestPrice?.minimumBidPrice ?? 0,
        };
      }
      setLivePrices(map);
    } catch (err) {
      log(`Price fetch error: ${err}`);
    }
    setFetchingPrices(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader
        title="RunPod Launcher"
        subtitle="Package dataset, launch Kohya training pod, monitor progress"
        actions={
          <button className="btn-ghost" onClick={refreshPods}>
            <RefreshCw size={12} style={{ display: "inline", marginRight: "5px" }} />
            Refresh Pods
          </button>
        }
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: config panel */}
        <div style={{
          width: "340px",
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          overflow: "auto",
          padding: "20px",
          background: "var(--bg-1)",
        }}>
          {/* Dataset summary */}
          <div style={{ marginBottom: "20px" }}>
            <div className="section-label">Dataset Summary</div>
            <div style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "12px",
              marginTop: "6px",
            }}>
              {[
                { label: "Character", value: character.name || "—" },
                { label: "Trigger word", value: character.triggerWord || "—" },
                { label: "Approved images", value: `${approved.length}` },
                { label: "Est. training time", value: estimatedTime ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>{label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-primary)" }}>{value}</span>
                </div>
              ))}
              {approved.length < 15 && (
                <div style={{
                  marginTop: "8px",
                  padding: "6px 8px",
                  background: "rgba(154,74,74,0.1)",
                  border: "1px solid var(--red)",
                  borderRadius: "4px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "#d47070",
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                }}>
                  <AlertTriangle size={11} />
                  {approved.length < 10 ? "Minimum 10 images recommended" : "15-20 images recommended for best results"}
                </div>
              )}
            </div>
          </div>

          {/* GPU selection */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div className="section-label" style={{ margin: 0 }}>GPU</div>
              <button className="btn-ghost" onClick={fetchPrices} disabled={fetchingPrices} style={{ padding: "2px 8px", fontSize: "10px" }}>
                <RefreshCw size={10} style={{ display: "inline", marginRight: "4px" }} />
                {fetchingPrices ? "Fetching…" : "Refresh Prices"}
              </button>
            </div>
            {RECOMMENDED_GPUS.map((gpu) => {
              const price = livePrices?.[gpu.id];
              const priceStr = price
                ? config.cloudType === "COMMUNITY"
                  ? `$${price.community.toFixed(2)}/hr spot`
                  : `$${price.secure.toFixed(2)}/hr`
                : null;
              return (
                <div
                  key={gpu.id}
                  onClick={() => setConfig((c) => ({ ...c, gpuTypeId: gpu.id }))}
                  style={{
                    padding: "8px 10px",
                    marginTop: "4px",
                    borderRadius: "5px",
                    cursor: "pointer",
                    background: config.gpuTypeId === gpu.id ? "var(--accent-glow)" : "var(--bg-2)",
                    border: `1px solid ${config.gpuTypeId === gpu.id ? "var(--accent-dim)" : "var(--border)"}`,
                    transition: "all 0.1s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: config.gpuTypeId === gpu.id ? "var(--accent-bright)" : "var(--text-primary)" }}>
                    {gpu.label}
                  </div>
                  {priceStr && (
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: config.gpuTypeId === gpu.id ? "var(--accent-bright)" : "var(--text-muted)", opacity: 0.9 }}>
                      {priceStr}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Cloud type */}
          <div style={{ marginBottom: "16px" }}>
            <div className="section-label">Cloud Type</div>
            <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
              {(["SECURE", "COMMUNITY"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setConfig((c) => ({ ...c, cloudType: t }))}
                  style={{
                    flex: 1, padding: "6px",
                    background: config.cloudType === t ? "var(--bg-4)" : "var(--bg-2)",
                    border: `1px solid ${config.cloudType === t ? "var(--accent-dim)" : "var(--border)"}`,
                    color: config.cloudType === t ? "var(--accent-bright)" : "var(--text-muted)",
                    borderRadius: "4px", cursor: "pointer",
                    fontFamily: "var(--font-display)", fontSize: "10px",
                    fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                  }}
                >{t}</button>
              ))}
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              Secure = guaranteed availability. Community = cheaper but interruptible.
            </div>
          </div>

          {/* Training hyperparams */}
          <div style={{ marginBottom: "20px" }}>
            <div className="section-label">Training Hyperparameters</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "6px" }}>
              {[
                { label: "Steps", key: "steps" as const, type: "number" },
                { label: "LR", key: "learningRate" as const, type: "text" },
                { label: "Network Dim", key: "networkDim" as const, type: "number" },
                { label: "Resolution", key: "resolution" as const, type: "number" },
              ].map(({ label, key, type }) => {
                const suggestedSteps = approved.length > 0
                  ? Math.max(500, Math.min(4000, Math.round(approved.length * 100 / 100) * 100))
                  : null;
                return (
                  <div key={key}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginBottom: "3px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                    <input
                      type={type}
                      style={{ width: "100%" }}
                      value={config[key]}
                      onChange={(e) => setConfig((c) => ({
                        ...c,
                        [key]: type === "number" ? parseInt(e.target.value) || 0 : e.target.value
                      }))}
                    />
                    {key === "steps" && suggestedSteps && config.steps !== suggestedSteps && (
                      <div
                        onClick={() => setConfig((c) => ({ ...c, steps: suggestedSteps }))}
                        style={{ marginTop: "3px", fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--accent-dim)", cursor: "pointer", letterSpacing: "0.04em" }}
                        title={`${approved.length} images × 100 steps`}
                      >
                        → suggest {suggestedSteps}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{
              marginTop: "8px",
              fontFamily: "var(--font-body)",
              fontStyle: "italic",
              fontSize: "11px",
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}>
              Recommended for Illustrious: dim=32, alpha=16, lr=1e-4, 1500–2500 steps depending on dataset size.
            </div>
          </div>

          {/* Low-image confirmation banner */}
          {confirmLowImages && (
            <div style={{
              marginBottom: "12px",
              padding: "10px 12px",
              background: "rgba(154,74,74,0.12)",
              border: "1px solid var(--red)",
              borderRadius: "6px",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "#d47070",
              lineHeight: 1.5,
            }}>
              <div style={{ marginBottom: "8px" }}>
                Only {approved.length} approved image{approved.length !== 1 ? "s" : ""}. Minimum 15–20 recommended for good results.
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={packageDataset} style={{
                  padding: "4px 12px", fontSize: "10px", cursor: "pointer",
                  background: "var(--red)", border: "none", color: "white",
                  borderRadius: "3px", fontFamily: "var(--font-display)",
                  fontWeight: 600, letterSpacing: "0.05em",
                }}>Proceed anyway</button>
                <button onClick={() => setConfirmLowImages(false)} style={{
                  padding: "4px 12px", fontSize: "10px", cursor: "pointer",
                  background: "transparent", border: "1px solid var(--border)",
                  color: "var(--text-muted)", borderRadius: "3px",
                  fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em",
                }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              className={phase === "packaging" ? "btn-ghost" : "btn-primary"}
              onClick={packageDataset}
              disabled={phase === "packaging" || phase === "training"}
            >
              <Upload size={12} style={{ display: "inline", marginRight: "5px" }} />
              {phase === "packaging" ? "Packaging…" : "1. Package Dataset"}
            </button>

            <button
              className="btn-primary"
              onClick={launchPod}
              disabled={!zipPath || phase === "training" || phase === "packaging"}
              style={{ opacity: !zipPath ? 0.4 : 1 }}
            >
              <Play size={12} style={{ display: "inline", marginRight: "5px" }} />
              2. Launch Training Pod
            </button>

            {pod && phase === "training" && (
              <button className="btn-danger" onClick={terminateCurrentPod}>
                <Square size={12} style={{ display: "inline", marginRight: "5px" }} />
                Terminate Pod
              </button>
            )}
          </div>
        </div>

        {/* Right: log + pod status */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Pod status card */}
          {pod && (
            <div style={{
              padding: "14px 20px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-2)",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  background: pod.status === "RUNNING" ? "var(--green)" : pod.status === "EXITED" ? "var(--red)" : "var(--accent)",
                  flexShrink: 0,
                  ...(pod.status === "RUNNING" ? { animation: "pulse 2s infinite" } : {}),
                }} />
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                    Pod {pod.id.slice(0, 8)}… — <span style={{ color: pod.status === "RUNNING" ? "var(--green)" : "var(--text-secondary)" }}>{pod.status}</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
                    ${pod.costPerHr?.toFixed(3) ?? "?"} USD/hr
                    {pod.runtime?.uptimeInSeconds ? ` · ${Math.floor(pod.runtime.uptimeInSeconds / 60)}m uptime` : ""}
                    {polling ? " · polling every 15s" : ""}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Log terminal */}
          <div style={{
            flex: 1,
            overflow: "auto",
            padding: "16px 20px",
            background: "var(--bg-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            lineHeight: 1.7,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
              color: "var(--text-muted)",
            }}>
              <Terminal size={12} />
              <span style={{ letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "9px" }}>
                Activity Log
              </span>
            </div>
            {logs.length === 0 && (
              <div style={{ color: "var(--text-muted)" }}>
                Ready. Package your dataset to begin.
              </div>
            )}
            {logs.map((line, i) => (
              <div key={i} style={{
                color: line.includes("ERROR") ? "#d47070" : line.startsWith("[") && line.includes("→") ? "var(--accent-bright)" : line.startsWith("[") ? "var(--text-secondary)" : "var(--text-muted)",
              }}>
                {line || <br />}
              </div>
            ))}
          </div>

          {/* Kohya command reference */}
          {zipPath && (
            <div style={{
              padding: "12px 20px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-1)",
              flexShrink: 0,
            }}>
              <div className="section-label">Training Command (run in pod terminal)</div>
              <div style={{
                marginTop: "6px",
                padding: "8px 12px",
                background: "var(--bg-0)",
                borderRadius: "4px",
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--accent-bright)",
                userSelect: "all",
              }}>
                python /workspace/kohya_ss/train_network.py --config_file /workspace/kohya_config.toml
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
