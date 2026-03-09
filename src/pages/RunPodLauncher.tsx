import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Upload, Play, Square, RefreshCw, Terminal, AlertTriangle, ExternalLink, Search, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore } from "../store";
import {
  listGpuTypes, createPod, getPod, terminatePod, listPods,
  listNetworkVolumes, jupyterUploadFile, jupyterRunCommand,
  RECOMMENDED_GPUS, KOHYA_POD_TEMPLATE, generateKohyaConfig, gpuTrainingFlags,
  Pod, NetworkVolume,
} from "../lib/runpod";

interface SearchResult {
  source: "civitai" | "huggingface";
  label: string;
  sublabel: string;
  downloadUrl: string;
}


type Phase = "config" | "packaging" | "uploading" | "training" | "done";

function logColor(line: string): string {
  if (/error|traceback|exception|failed|failure|abort/i.test(line)) return "#d47070";
  if (/warning|warn:|extracting/i.test(line)) return "#d4a04a";
  if (/saved|complete|finished|terminated|downloaded|uploaded|extracted|success|done\b|all done|zipped|created|linked|✓/i.test(line)) return "#6abf8a";
  if (/step \d+\/\d+|uploading|launching|packaging|downloading|training|epoch \d+|waiting|it\/s|s\/it/i.test(line)) return "var(--accent-bright)";
  if (line.startsWith("[")) return "var(--text-secondary)";
  return "var(--text-muted)";
}

// Module-level state — survives HMR remounts (React Fast Refresh doesn't re-run module scope)
let _podPollId: ReturnType<typeof setInterval> | null = null;
let _logPollId: ReturnType<typeof setInterval> | null = null;
let _jupyterWaitId: ReturnType<typeof setInterval> | null = null;
let _uploadInProgress = false;

export default function RunPodLauncher() {
  const { character, images, settings, setSettings, training: config, updateTraining: setConfig, runpodLogs: logs, addRunpodLog, clearRunpodLogs, runpodActivePodId, runpodActiveJupyterUrl, setRunpodActivePodId, setRunpodActiveJupyterUrl } = useStore();
  const [phase, setPhase] = useState<Phase>(runpodActivePodId ? "training" : "config");
  const [pipelineStep, setPipelineStep] = useState(runpodActivePodId ? 0 : -1);
  const [pod, setPodLocal] = useState<Pod | null>(null);
  const podRef = useRef<Pod | null>(null);
  const setPod = (p: Pod | null) => { setPodLocal(p); podRef.current = p; setRunpodActivePodId(p?.id ?? ""); };
  const [zipPath, setZipPath] = useState("");
  const [existingZip, setExistingZip] = useState(false);
  const [activePods, setActivePods] = useState<Pod[]>([]);
  const [polling, setPolling] = useState(false);
  const [confirmLowImages, setConfirmLowImages] = useState(false);
  const [jupyterUrl, setJupyterUrlLocal] = useState<string | null>(runpodActiveJupyterUrl || null);
  const setJupyterUrl = (url: string | null) => { setJupyterUrlLocal(url); setRunpodActiveJupyterUrl(url ?? ""); };
  const [livePrices, setLivePrices] = useState<Record<string, { secure: number; community: number }> | null>(null);
  const [liveGpuTypes, setLiveGpuTypes] = useState<Array<{ id: string; displayName: string; memoryInGb: number; secureCloud: boolean; communityCloud: boolean }> | null>(null);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [networkVolumes, setNetworkVolumes] = useState<NetworkVolume[]>([]);
  const [fetchingVolumes, setFetchingVolumes] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [trainingHalted, setTrainingHalted] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelResults, setModelResults] = useState<SearchResult[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSelected, setModelSelected] = useState("");
  const [logCopied, setLogCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logScrollRef = useRef<HTMLDivElement>(null);
  // GPU IDs available in the selected volume's specific datacenter (for cache-hit detection)
  const [dcGpuIds, setDcGpuIds] = useState<Set<string>>(new Set());
  // Effective volume ID for the current training run (null when GPU is outside volume's DC)
  const effectiveVolumeIdRef = useRef<string | null>(null);
  const [downloadIntermediates, setDownloadIntermediates] = useState(false);
  const downloadIntermediatesRef = useRef(false);
  useEffect(() => { downloadIntermediatesRef.current = downloadIntermediates; }, [downloadIntermediates]);
  const [autoTerminate, setAutoTerminate] = useState(true);
  const autoTerminateRef = useRef(true);
  useEffect(() => { autoTerminateRef.current = autoTerminate; }, [autoTerminate]);
  // Non-stale refs for use inside polling intervals / async callbacks
  const characterRef = useRef(character);
  useEffect(() => { characterRef.current = character; }, [character]);
  const apiKeyRef = useRef(settings.runpodApiKey);
  useEffect(() => { apiKeyRef.current = settings.runpodApiKey; }, [settings.runpodApiKey]);

  const approved = images.filter((i) => i.approved === true);

  const expectedZipPath = character.outputDir && character.triggerWord
    ? `${character.outputDir}/${character.triggerWord}_dataset.zip`
    : null;

  useEffect(() => {
    if (!expectedZipPath) return;
    invoke<boolean>("path_exists", { path: expectedZipPath }).then((exists) => {
      if (exists) { setZipPath(expectedZipPath); setExistingZip(true); }
    }).catch(() => {});
  }, [expectedZipPath]);

  // Seed model search query from character.baseModel on mount
  useEffect(() => {
    if (!modelQuery && character.baseModel) {
      const filename = character.baseModel.split(/[\\/]/).pop() ?? character.baseModel;
      const seed = filename
        .replace(/\.[^.]+$/, "")   // strip extension
        .replace(/[_-]/g, " ")     // underscores/hyphens → spaces
        .replace(/\s+/g, " ").trim();
      setModelQuery(seed);
    }
  }, [character.baseModel]);

  // Auto-populate local path fallback from character's base model path
  useEffect(() => {
    if (character.baseModel && !config.baseModelLocalPath) {
      setConfig({ baseModelLocalPath: character.baseModel });
    }
  }, [character.baseModel]);

  const hasApiKey = !!settings.runpodApiKey;

  useEffect(() => {
    if (!hasApiKey) return;
    fetchVolumes();
    refreshPods();
  }, [hasApiKey]);

  // Check pod state on reconnect — skip re-uploading files already present and stable
  const checkAndResume = async (jUrl: string) => {
    const JUPYTER_PASS = "lorastudio";
    const zipName = `${character.triggerWord}_dataset.zip`;
    const modelBaseName = (character.baseModel || "model.safetensors")
      .replace(/\s*\[.*?\]\s*$/, "").trim().split(/[\\/]/).pop() || "model.safetensors";

    log("Checking pod state before restart…");
    setUploadStatus("Checking pod state…");

    try {
      const [extractResult, manifestResult] = await Promise.allSettled([
        invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.extract_done" }),
        invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.model_manifest" }),
      ]);

      const datasetReady = extractResult.status === "fulfilled";
      const modelReady = manifestResult.status === "fulfilled";

      if (datasetReady && modelReady) {
        const selectedVram = RECOMMENDED_GPUS.find(g => g.id === config.gpuTypeId)?.vram ?? 0;
        const gpuFlags = gpuTrainingFlags(selectedVram, config.optimizer);
        log("Dataset and model already on pod — launching training directly…");
        setPipelineStep(3);
        setUploadStatus(null);
        await launchTraining(jUrl, modelBaseName, gpuFlags);
        return;
      }

      if (!datasetReady) {
        // Check if the zip is on the pod and not mid-transfer (size stable over ~10s)
        log("Dataset not yet extracted — checking zip status…");
        await jupyterRunCommand(jUrl, JUPYTER_PASS, `stat -c%s /workspace/${zipName} 2>/dev/null > /workspace/.zipsize.txt`);
        await new Promise(r => setTimeout(r, 5000));
        const size1 = (await invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.zipsize.txt" }).catch(() => "")).trim();

        if (size1 && size1 !== "0") {
          await new Promise(r => setTimeout(r, 6000));
          await jupyterRunCommand(jUrl, JUPYTER_PASS, `stat -c%s /workspace/${zipName} 2>/dev/null > /workspace/.zipsize.txt`);
          await new Promise(r => setTimeout(r, 5000));
          const size2 = (await invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.zipsize.txt" }).catch(() => "")).trim();

          if (size1 !== size2) {
            log(`Dataset zip still transferring (${size1} → ${size2} bytes) — not interrupting. Monitor in Jupyter.`);
            setUploadStatus(null);
            startLogPolling(jUrl, 0);
            return;
          }
          log(`Dataset zip present and stable (${Number(size1).toLocaleString()} bytes) — skipping re-upload.`);
          setUploadStatus(null);
          uploadToVolume(jUrl, { skipZipUpload: true });
          return;
        }
      }

      // Files not on pod — full restart
      setUploadStatus(null);
      log("Restarting upload…");
      uploadToVolume(jUrl);
    } catch {
      // Jupyter not responding yet — wait for it to come up
      setUploadStatus(null);
      log("Jupyter not responding yet — waiting for pod to finish starting…");
      startJupyterWait(jUrl);
    }
  };

  // Reconnect to an active pod if we navigated away and came back
  useEffect(() => {
    if (!runpodActivePodId || !hasApiKey) return;
    getPod(settings.runpodApiKey, runpodActivePodId).then((p) => {
      setPodLocal(p);
      setPhase("training");
      // Restart pod status polling
      startPolling(runpodActivePodId);
      // If Jupyter was already ready, restart log polling from end of already-seen lines
      if (runpodActiveJupyterUrl) {
        jupyterUrlRef.current = runpodActiveJupyterUrl;
        setJupyterUrlLocal(runpodActiveJupyterUrl);
        log(`Reconnected to pod ${runpodActivePodId} — checking training status…`);
        // Check whether training has started by reading training.log
        invoke<string>("jupyter_read_file", {
          jupyterUrl: runpodActiveJupyterUrl,
          password: "lorastudio",
          remotePath: "workspace/training.log",
        }).then((content) => {
          if (content.trim()) {
            if (content.includes("training complete")) {
              log(`Training already completed — ready to download.`);
              setPhase("done");
            } else if (content.includes("training failed")) {
              log(`Training previously failed — see pod logs. Use Retry to relaunch or Terminate to stop billing.`);
              setTrainingHalted(true);
            } else {
              log(`Training already running — resuming log tail…`);
              startLogPolling(runpodActiveJupyterUrl, content.split("\n").length);
            }
          } else {
            log(`Training log empty — restarting upload…`);
            uploadToVolume(runpodActiveJupyterUrl);
          }
        }).catch(() => {
          // training.log doesn't exist — check what's on the pod before deciding what to re-upload
          checkAndResume(runpodActiveJupyterUrl);
        });
      }
    }).catch(() => {
      // Pod no longer exists — clear stored state
      setRunpodActivePodId("");
      setRunpodActiveJupyterUrl("");
      setPhase("config");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally runs once on mount

  const fetchVolumes = async () => {
    setFetchingVolumes(true);
    try {
      const vols = await listNetworkVolumes(settings.runpodApiKey);
      setNetworkVolumes(vols);
      // Auto-select if only one volume and none selected
      if (vols.length === 1 && !config.networkVolumeId) {
        setConfig({ networkVolumeId: vols[0].id });
      }
    } catch (err) {
      log(`Volume fetch error: ${err}`);
    }
    setFetchingVolumes(false);
  };

  // Infer stepsPerSec for any GPU by VRAM tier (used for both estimatedTime and bestValueGpu)
  const stepsPerSecForGpu = (gpuId: string): number | null => {
    const known = RECOMMENDED_GPUS.find((g) => g.id === gpuId);
    if (known) return known.stepsPerSec;
    const live = liveGpuTypes?.find((g) => g.id === gpuId);
    if (!live) return null;
    return live.memoryInGb >= 80 ? 0.70 : live.memoryInGb >= 40 ? 0.45 : live.memoryInGb >= 24 ? 0.25 : 0.15;
  };

  const resFactor = Math.pow(1024 / config.resolution, 1.5);

  const estimatedTime = (() => {
    const sps = stepsPerSecForGpu(config.gpuTypeId);
    if (!sps) return null;
    const seconds = config.steps / (sps * resFactor);
    if (seconds < 60) return `~${Math.round(seconds)}s`;
    if (seconds < 3600) return `~${Math.round(seconds / 60)}min`;
    return `~${(seconds / 3600).toFixed(1)}hr`;
  })();

  // Best-value GPU: lowest estimated total cost = (training + 20min padding) × price/hr
  // Only computed once live prices are available; excludes GPUs with no current price (unavailable).
  const bestValueGpuId = (() => {
    if (!livePrices || !liveGpuTypes) return null;
    const PADDING_HOURS = 20 / 60;
    const gpuList = liveGpuTypes.filter((g) =>
      config.cloudType === "COMMUNITY" ? g.communityCloud : g.secureCloud
    );
    let best: { id: string; cost: number } | null = null;
    for (const g of gpuList) {
      const price = config.cloudType === "COMMUNITY"
        ? (livePrices[g.id]?.community ?? 0)
        : (livePrices[g.id]?.secure ?? 0);
      if (price <= 0) continue; // not available right now
      const sps = stepsPerSecForGpu(g.id);
      if (!sps) continue;
      const trainingHours = config.steps / (sps * resFactor) / 3600;
      const totalCost = (trainingHours + PADDING_HOURS) * price;
      if (!best || totalCost < best.cost) best = { id: g.id, cost: totalCost };
    }
    return best;
  })();

  const logFilePath = character.outputDir ? `${character.outputDir}/runpod.log` : null;
  const log = (msg: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    addRunpodLog(line);
    if (logFilePath) {
      // Append by writing full log — fire and forget
      invoke("save_project", { path: logFilePath, data: [...logs, line].join("\n") }).catch(() => {});
    }
  };

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
      setExistingZip(true);
      log(`Dataset zipped → ${zipOut}`);

      // Generate Kohya dataset config (dataset sections only — training params go via CLI)
      const kohyaConf = generateKohyaConfig({
        triggerWord: character.triggerWord,
        datasetDir: `/workspace/dataset`,
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
      const selectedVol = networkVolumes.find((v) => v.id === config.networkVolumeId);
      // Only attach the volume if the selected GPU type is available in the volume's DC.
      // If dcGpuIds is empty (no volume selected or prices not fetched), fall through to no-volume mode.
      const gpuInVolumesDc = !!config.networkVolumeId && dcGpuIds.has(config.gpuTypeId);
      const useVolume = gpuInVolumesDc;
      const dataCenterId = useVolume ? selectedVol?.dataCenterId : undefined;
      effectiveVolumeIdRef.current = useVolume ? config.networkVolumeId : null;

      if (config.networkVolumeId && !useVolume) {
        log(`Note: Selected GPU is not available in volume's datacenter (${selectedVol?.dataCenterId}). Launching without volume — model will download fresh.`);
      }

      const podSpec = {
        name: `lora-${character.triggerWord}-${Date.now()}`,
        ...KOHYA_POD_TEMPLATE,
        imageName: settings.dockerImage || "ashleykza/kohya:latest",
        gpuTypeId: config.gpuTypeId,
        cloudType: config.cloudType,
        containerDiskInGb: config.containerDiskInGb,
        // With a network volume: /workspace is the network volume, local vol only needs a few GB for temp
        // Without: /workspace must hold the model (4-8GB+), dataset, and output — use 50GB
        volumeInGb: useVolume ? 5 : 50,
        ...(useVolume ? { networkVolumeId: config.networkVolumeId } : { volumeMountPath: undefined }),
        ...(dataCenterId ? { dataCenterId } : {}),
        env: [
          { key: "JUPYTER_PASSWORD", value: "lorastudio" },
        ],
      };
      log(`Spec: gpu=${podSpec.gpuTypeId} cloud=${podSpec.cloudType} disk=${podSpec.containerDiskInGb}GB vol=${podSpec.volumeInGb}GB dc=${dataCenterId ?? "any"} image=${podSpec.imageName}`);
      const newPod = await createPod(settings.runpodApiKey, podSpec);
      setPod(newPod);
      log(`Pod created: ${newPod.id} (${newPod.status})`);
      log(`Cost: ~$${newPod.costPerHr?.toFixed(2) ?? "?"} USD/hr`);
      log(`Waiting for pod to start and trainer to launch…`);
      startPolling(newPod.id);
      setPipelineStep(0);
    } catch (err) {
      const msg = String(err);
      log(`Launch ERROR: ${msg}`);
      if (msg.toLowerCase().includes("no longer any instances") || msg.toLowerCase().includes("requested specifications")) {
        const vol = networkVolumes.find((v) => v.id === config.networkVolumeId);
        if (vol) {
          log(`→ Your network volume is in ${vol.dataCenterId}. RunPod can only launch pods in that datacenter.`);
          log(`→ Try: create a new volume in a different datacenter (EU-RO-1 / US-TX-3 tend to have more capacity), or deselect the volume to launch anywhere.`);
        } else {
          log("→ Try switching to COMMUNITY cloud or a different GPU type.");
        }
      }
      setPhase("uploading");
    }
  };

  const jupyterUrlRef = useRef("");

  useEffect(() => {
    if (autoScroll && logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Start polling Jupyter readiness — clears any existing wait first (prevents duplicates across remounts)
  const startJupyterWait = (url: string) => {
    if (_jupyterWaitId) { clearInterval(_jupyterWaitId); _jupyterWaitId = null; }
    let attempts = 0;
    log(`Waiting for Jupyter to come up…`);
    _jupyterWaitId = setInterval(async () => {
      attempts++;
      const ready = await invoke<boolean>("jupyter_is_ready", { jupyterUrl: url, password: "lorastudio" });
      if (ready) {
        if (_jupyterWaitId) { clearInterval(_jupyterWaitId); _jupyterWaitId = null; }
        log(`Jupyter ready — starting upload…`);
        uploadToVolume(url);
      } else if (attempts >= 48) {
        if (_jupyterWaitId) { clearInterval(_jupyterWaitId); _jupyterWaitId = null; }
        log(`Jupyter unreachable after 12 min — pod may still be starting. Open ${url}/lab to check manually.`);
      }
    }, 15000);
  };

  const launchTraining = async (jUrl: string, modelBaseName: string, gpuFlags: { batchSize: number; gradientCheckpointing: boolean; cacheLatents: boolean }) => {
    const JUPYTER_PASS = "lorastudio";
    // Guard: refuse to launch if training is already running on the pod
    try {
      await jupyterRunCommand(jUrl, JUPYTER_PASS, `pgrep -f sdxl_train_network > /workspace/.trainpid.txt 2>/dev/null || echo "" > /workspace/.trainpid.txt`);
      await new Promise(r => setTimeout(r, 2000));
      const pid = (await invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.trainpid.txt" }).catch(() => "")).trim();
      if (pid) {
        log(`Training already running (pid ${pid}) — not launching a duplicate.`);
        startLogPolling(jUrl, 0);
        return;
      }
    } catch { /* proceed */ }
    setUploadStatus(`Launching training…`);
    log(`Launching training…`);
    const isAdaptive = config.optimizer === "Prodigy" || config.optimizer === "DAdaptAdam";
    const networkAlpha = isAdaptive ? 1 : Math.floor(config.networkDim / 2);
    const lr = isAdaptive ? "1.0" : config.learningRate;
    const lrScheduler = isAdaptive ? "constant" : "cosine_with_restarts";
    const lrWarmupSteps = isAdaptive ? 0 : Math.round(config.steps * 0.05);
    const lrWarmupFlag = isAdaptive ? "" : `--lr_warmup_steps ${lrWarmupSteps}`;
    const optimizerArgs = config.optimizer === "Prodigy"
      ? `--optimizer_args "decouple=True" "weight_decay=0.01" "d_coef=2" "use_bias_correction=True"`
      : config.optimizer === "DAdaptAdam"
      ? `--optimizer_args "decouple=True" "weight_decay=0.01"`
      : "";
    const saveEveryNSteps = Math.max(100, Math.round(config.steps / 20));
    const trainScript = config.sdxl ? "sdxl_train_network.py" : "train_network.py";
    const gradCkptFlag = gpuFlags.gradientCheckpointing ? "--gradient_checkpointing" : "";
    const cacheLatentsFlag = gpuFlags.cacheLatents ? "--cache_latents" : "";
    log(`[info] accelerate launch ${trainScript} --optimizer_type ${config.optimizer} --max_train_steps ${config.steps} --network_dim ${config.networkDim} --network_alpha ${networkAlpha}`);
    await jupyterRunCommand(jUrl, JUPYTER_PASS,
      `nohup bash -c '> /workspace/training.log; SCRIPT=\$(find /workspace -maxdepth 5 -name "${trainScript}" 2>/dev/null | head -1); if [ -z "\$SCRIPT" ]; then echo "ERROR: ${trainScript} not found" >> /workspace/training.log; exit 1; fi; PYTHON=""; for P in /venv/bin/python3 /venv/bin/python /opt/conda/bin/python3 /workspace/venv/bin/python3 /workspace/venv/bin/python /usr/local/bin/python3; do if [ -f "\$P" ] && "\$P" -c "import accelerate" 2>/dev/null; then PYTHON="\$P"; break; fi; done; if [ -z "\$PYTHON" ]; then echo "ERROR: no Python with accelerate found" >> /workspace/training.log; exit 1; fi; ACCEL=\$(dirname "\$PYTHON")/accelerate; mkdir -p /workspace/output; echo "launcher: \$ACCEL" >> /workspace/training.log; export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True; cd "\$(dirname "\$SCRIPT")" && "\$ACCEL" launch --num_cpu_threads_per_process 1 "\$SCRIPT" --dataset_config /workspace/kohya_config.toml --pretrained_model_name_or_path /workspace/models/${modelBaseName} --output_dir /workspace/output --output_name ${character.triggerWord}_lora --save_model_as safetensors --max_train_steps ${config.steps} --learning_rate ${lr} --lr_scheduler ${lrScheduler} ${lrWarmupFlag} --optimizer_type ${config.optimizer} ${optimizerArgs} --network_module networks.lora --network_dim ${config.networkDim} --network_alpha ${networkAlpha} --min_snr_gamma 5 --noise_offset 0.05 --mixed_precision fp16 --save_precision fp16 ${gradCkptFlag} ${cacheLatentsFlag} --save_every_n_steps ${saveEveryNSteps} >> /workspace/training.log 2>&1; EXIT_CODE=\$?; if [ \$EXIT_CODE -eq 0 ]; then echo "training complete" >> /workspace/training.log; else echo "training failed (exit \$EXIT_CODE)" >> /workspace/training.log; fi' &`
    );
    setPipelineStep(3);
    setTrainingHalted(false);
    setUploadStatus(null);
    log(`Training started — polling /workspace/training.log for progress…`);
    log(`Note: training typically takes 30–90 minutes. You can close the app and reopen it later — it will reconnect to the running pod.`);
    startLogPolling(jUrl, 0);
  };

  const uploadToVolume = async (jUrl: string, opts: { skipZipUpload?: boolean } = {}) => {
    if (_uploadInProgress) { log("Upload already in progress — ignoring duplicate request."); return; }
    _uploadInProgress = true;
    const actualZipPath = zipPath || expectedZipPath;
    if (!actualZipPath && !opts.skipZipUpload) { _uploadInProgress = false; return; }
    const JUPYTER_PASS = "lorastudio";
    const volumeId = effectiveVolumeIdRef.current;
    const datasetKey = `${character.triggerWord}_${Date.now()}`;
    const existing = volumeId ? settings.volumeContents?.[volumeId] : null;
    const zipName = opts.skipZipUpload
      ? `${character.triggerWord}_dataset.zip`
      : actualZipPath!.split("/").pop()!;

    try {
      // Determine optimal training flags for the selected GPU
      const selectedVram =
        RECOMMENDED_GPUS.find(g => g.id === config.gpuTypeId)?.vram ??
        liveGpuTypes?.find(g => g.id === config.gpuTypeId)?.memoryInGb ??
        0;
      const gpuFlags = gpuTrainingFlags(selectedVram, config.optimizer);
      if (selectedVram > 0) {
        log(`GPU: ${config.gpuTypeId} (${selectedVram}GB VRAM) → batch=${gpuFlags.batchSize}, grad_ckpt=${gpuFlags.gradientCheckpointing}, cache_latents=${gpuFlags.cacheLatents}`);
      } else {
        log(`GPU VRAM unknown — using conservative training config`);
      }

      // Regenerate and upload kohya config — always generate fresh so code changes are reflected
      const configName = "kohya_config.toml";
      const kohyaConf = generateKohyaConfig({
        triggerWord: character.triggerWord,
        datasetDir: `/workspace/dataset`,
        resolution: config.resolution,
        batchSize: gpuFlags.batchSize,
      });
      const configPath = `${character.outputDir}/kohya_config.toml`;
      await invoke("save_project", { path: configPath, data: kohyaConf });
      setPipelineStep(1);
      setUploadStatus(`Uploading kohya_config.toml…`);
      log(`Uploading kohya_config.toml…`);
      await jupyterUploadFile(jUrl, JUPYTER_PASS, `workspace/${configName}`, configPath);
      log(`Config uploaded.`);

      // Dataset upload + extraction — skip if already extracted on pod
      let datasetExtracted = false;
      try {
        await invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.extract_done" });
        log("Dataset already extracted on pod — skipping upload.");
        datasetExtracted = true;
      } catch { /* needs extraction */ }

      if (!datasetExtracted) {
        if (!opts.skipZipUpload) {
          setUploadStatus(`Uploading dataset zip (${zipName})…`);
          log(`Uploading ${zipName} to volume…`);
          await jupyterUploadFile(jUrl, JUPYTER_PASS, `workspace/${zipName}`, actualZipPath!);
          log(`Dataset uploaded.`);
        }
        setUploadStatus(`Extracting dataset on pod…`);
        log(`Extracting dataset…`);
        await jupyterRunCommand(jUrl, JUPYTER_PASS, `rm -f /workspace/.extract_done; nohup bash -c 'cd /workspace && mkdir -p dataset models && unzip -o ${zipName} -d dataset && echo done > /workspace/.extract_done' &`);
        let extracted = false;
        for (let i = 0; i < 60 && !extracted; i++) {
          await new Promise(r => setTimeout(r, 5000));
          setUploadStatus(`Extracting dataset… (${(i + 1) * 5}s)`);
          try {
            await invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.extract_done" });
            extracted = true;
          } catch { /* not done yet */ }
        }
        if (!extracted) throw new Error("Dataset extraction timed out after 5 minutes");
      }

      // Handle base model checkpoint
      setPipelineStep(2);
      const modelName = (character.baseModel || "model.safetensors").replace(/\s*\[.*?\]\s*$/, "").trim();
      const modelBaseName = modelName.split(/[\\/]/).pop() || "model.safetensors";

      let modelOnVolume = false;
      try {
        const manifest = await invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.model_manifest" });
        modelOnVolume = manifest.trim() === modelBaseName;
      } catch { /* manifest absent — volume is fresh or manifest was not written */ }
      if (!modelOnVolume) modelOnVolume = existing?.modelName === modelBaseName;

      if (modelOnVolume) {
        log(`Model already on volume (${modelBaseName}) — skipping download.`);
      } else if (config.baseModelDownloadUrl) {
        if (existing?.modelName && existing.modelName !== modelBaseName) {
          log(`WARNING: Replacing model on volume (${existing.modelName} → ${modelBaseName}).`);
        }
        log(`Downloading checkpoint via pod: ${config.baseModelDownloadUrl}`);
        await jupyterRunCommand(jUrl, JUPYTER_PASS,
          `rm -f /workspace/.model_done; mkdir -p /workspace/models && nohup bash -c 'wget -q -O /workspace/models/${modelBaseName} "${config.baseModelDownloadUrl}" && echo "${modelBaseName}" > /workspace/.model_manifest && echo done > /workspace/.model_done' &`
        );
        let modelReady = false;
        for (let i = 0; i < 120 && !modelReady; i++) {
          await new Promise(r => setTimeout(r, 15000));
          const elapsed = `${Math.floor((i + 1) * 15 / 60)}m ${((i + 1) * 15) % 60}s`;
          setUploadStatus(`Downloading ${modelBaseName} on pod… (${elapsed})`);
          try {
            await invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.model_done" });
            modelReady = true;
          } catch { /* not done yet */ }
        }
        if (!modelReady) throw new Error(`Model download timed out after 30 minutes`);
        log(`Model downloaded.`);
      } else if (config.baseModelLocalPath) {
        if (existing?.modelName && existing.modelName !== modelBaseName) {
          log(`WARNING: Replacing model on volume (${existing.modelName} → ${modelBaseName}).`);
        }
        setUploadStatus(`Uploading ${modelBaseName} from local disk…`);
        log(`Uploading checkpoint from local path (this may take a while)…`);
        await jupyterUploadFile(jUrl, JUPYTER_PASS, `workspace/models/${modelBaseName}`, config.baseModelLocalPath);
        await jupyterRunCommand(jUrl, JUPYTER_PASS, `echo "${modelBaseName}" > /workspace/.model_manifest`);
        log(`Model uploaded.`);
      } else {
        log(`WARNING: No base model source set. Training will fail unless the model is already at /workspace/models/${modelBaseName}.`);
      }

      if (volumeId) {
        setSettings({ volumeContents: { ...settings.volumeContents, [volumeId]: { datasetKey, modelName: modelBaseName, uploadedAt: new Date().toISOString() } } });
      }

      await launchTraining(jUrl, modelBaseName, gpuFlags);
      _uploadInProgress = false;
    } catch (err) {
      _uploadInProgress = false;
      setUploadStatus(null);
      log(`Upload error: ${err}`);
    }
  };

  const downloadOutputs = async (jUrl: string) => {
    const JUPYTER_PASS = "lorastudio";
    const char = characterRef.current;
    const destDir = char.outputDir || char.loraDir;
    if (!destDir) { log(`Cannot download: no loraDir or outputDir set on character.`); return; }

    setPipelineStep(4);
    setDownloadFailed(false);
    log(`Training complete — downloading LoRA to ${destDir}…`);
    try {
      // Write file listing to a temp file on the pod
      await jupyterRunCommand(jUrl, JUPYTER_PASS, `ls /workspace/output/*.safetensors 2>/dev/null > /workspace/.output_list.txt`);
      await new Promise(r => setTimeout(r, 1500));
      const listing = await invoke<string>("jupyter_read_file", { jupyterUrl: jUrl, password: JUPYTER_PASS, remotePath: "workspace/.output_list.txt" });
      const files = listing.split("\n").map(l => l.trim()).filter(l => l.endsWith(".safetensors"));

      if (files.length === 0) {
        log(`No .safetensors files found in /workspace/output/`);
        return;
      }

      const toDownload = downloadIntermediatesRef.current
        ? files
        : files.filter(f => !/-step\d+/.test(f));

      log(`Found ${files.length} file(s), downloading ${toDownload.length}…`);
      for (const remotePath of toDownload) {
        const filename = remotePath.split("/").pop()!;
        const localPath = `${destDir}/${filename}`;
        log(`Downloading ${filename}…`);
        await invoke("jupyter_download_file", {
          jupyterUrl: jUrl,
          password: JUPYTER_PASS,
          remotePath: remotePath.replace(/^\//, ""),
          localPath,
        });
        log(`Saved → ${localPath}`);
      }
      setPipelineStep(5);
      log(`Download complete.`);
      // Auto-terminate pod to stop billing (if enabled)
      const podId = podRef.current?.id;
      const apiKey = apiKeyRef.current;
      if (autoTerminateRef.current && podId && apiKey) {
        try {
          await terminatePod(apiKey, podId);
          log(`Pod terminated — billing stopped.`);
          setPod(null);
          setPhase("done");
        } catch (err) {
          log(`Auto-terminate failed: ${err} — use the Terminate button to stop billing.`);
        }
      }
    } catch (err) {
      log(`Download error: ${err}`);
      log(`Pod is still running — use Retry Download to try again, or open Jupyter to retrieve the file manually.`);
      setDownloadFailed(true);
    }
  };

  const startLogPolling = (jUrl: string, fromLine: number) => {
    const JUPYTER_PASS = "lorastudio";
    let seenLines = fromLine;
    let inTraceback = false;
    if (_logPollId) clearInterval(_logPollId);
    _logPollId = setInterval(async () => {
      try {
        const content = await invoke<string>("jupyter_read_file", {
          jupyterUrl: jUrl,
          password: JUPYTER_PASS,
          remotePath: "workspace/training.log",
        });
        const lines = content.split("\n");
        const newLines = lines.slice(seenLines);
        seenLines = lines.length;

        let lastPodLine = "";
        for (const raw of newLines) {
          const line = raw.trimEnd();
          if (!line) { inTraceback = false; continue; }
          // Skip tqdm progress-bar lines (contain block chars or bare percentage bars)
          if (/[█▏▎▍▌▋▊▉]|^\s*\d+%\s*\|/.test(line)) continue;
          // Skip Kohya multi-process bookkeeping (logged 8× per epoch by accelerate workers)
          if (/epoch is incremented/i.test(line)) continue;

          const isError = /error|traceback|exception/i.test(line);
          const isImportant = isError || inTraceback ||
            /loss[= ]|epoch|saving|saved|step\s+\d|finished|complete|cuda|oom|python:|workspace:|dataset:/i.test(line);

          if (isImportant) {
            // Deduplicate consecutive identical pod lines (reconnect double-fire)
            if (line === lastPodLine) continue;
            lastPodLine = line;
            log(`[pod] ${line}`);
            if (isError) inTraceback = true;
          }
        }

        const newContent = newLines.join("\n");
        // Stop polling on completion or fatal halt (check only new lines to avoid re-triggering)
        if (/training (finished|complete|done)|^training complete$/im.test(newContent)) {
          if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
          downloadOutputs(jUrl);
        } else if (/training failed \(exit|ModuleNotFoundError|No module named|command not found/i.test(newContent)) {
          if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
          if (_podPollId) { clearInterval(_podPollId); _podPollId = null; setPolling(false); }
          log(`Training halted — see errors above.`);
          log(`Pod is still running — use Retry to relaunch, or Terminate to stop billing.`);
          setTrainingHalted(true);
        }
      } catch { /* file not yet available */ }
    }, 5000);
  };

  const startPolling = (podId: string) => {
    if (_podPollId) { clearInterval(_podPollId); _podPollId = null; }
    setPolling(true);
    let consecutiveErrors = 0;
    const stopPolling = (reason: string) => {
      log(reason);
      if (_podPollId) { clearInterval(_podPollId); _podPollId = null; }
      setPolling(false);
      setPod(null);
      setJupyterUrl(null);
      jupyterUrlRef.current = "";
      if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
      if (_jupyterWaitId) { clearInterval(_jupyterWaitId); _jupyterWaitId = null; }
      setUploadStatus(null);
      setPhase("done");
    };
    const tick = async () => {
      try {
        const updated = await getPod(settings.runpodApiKey, podId);
        consecutiveErrors = 0;
        setPod(updated);
        const terminal = updated.status === "EXITED" || updated.status === "TERMINATED" || updated.status === "DEAD";
        if (terminal) {
          stopPolling(`Pod ${updated.status.toLowerCase()} — terminated externally.`);
        } else if (updated.status === "RUNNING") {
          const uptime = updated.runtime?.uptimeInSeconds ?? 0;
          const url = `https://${updated.id}-8888.proxy.runpod.net`;
          setJupyterUrl(url);
          // Only start readiness polling once the pod has real uptime (Docker is running)
          if (!jupyterUrlRef.current && uptime > 0) {
            jupyterUrlRef.current = url;
            log(`Pod running (uptime: ${uptime}s) — waiting for Jupyter…`);
            startJupyterWait(url);
          }
        }
      } catch (err) {
        const msg = String(err).toLowerCase();
        if (msg.includes("not found") || msg.includes("does not exist") || msg.includes("no pod")) {
          stopPolling("Pod no longer found on RunPod — may have been deleted externally.");
        } else {
          consecutiveErrors++;
          if (consecutiveErrors >= 20) {
            // If upload/training is already running, API errors are just transient blips — don't terminate,
            // but back off to 60s polling to stop flooding the log.
            if (jupyterUrlRef.current) {
              log(`RunPod API unreachable — pod likely still running. Slowing status checks to 1/min.`);
              consecutiveErrors = 0;
              if (_podPollId) { clearInterval(_podPollId); }
              _podPollId = setInterval(tick, 60000);
            } else {
              stopPolling(`Pod unreachable after ${consecutiveErrors} attempts (~5 min) — assuming terminated.`);
            }
          }
        }
      }
    };
    tick();
    _podPollId = setInterval(tick, 15000);
    setTimeout(() => { if (_podPollId) { clearInterval(_podPollId); _podPollId = null; } setPolling(false); }, 1800000); // 30min max
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
      setActivePods(pods.filter((p) => p.status === "RUNNING" || p.status === "STARTING"));
    } catch (err) {
      log(`List pods error: ${err}`);
    }
  };

  const linkPod = (p: Pod) => {
    setPod(p);
    setPhase("training");
    setPipelineStep(0);
    log(`Linked to existing pod: ${p.id}`);
    startPolling(p.id);
  };

  const fetchPrices = async () => {
    if (!hasApiKey) { log("Add your RunPod API key in Settings first."); return; }
    setFetchingPrices(true);
    const selectedVol = networkVolumes.find((v) => v.id === config.networkVolumeId);
    const dataCenterId = selectedVol?.dataCenterId;
    try {
      // Always fetch global GPU list; if a volume is selected, also fetch DC-specific to identify cached GPUs
      const [allGpus, dcGpus] = await Promise.all([
        listGpuTypes(settings.runpodApiKey),
        dataCenterId ? listGpuTypes(settings.runpodApiKey, dataCenterId) : Promise.resolve([]),
      ]);
      setDcGpuIds(new Set(dcGpus.map((g) => g.id)));

      const map: Record<string, { secure: number; community: number }> = {};
      for (const g of allGpus) {
        map[g.id] = {
          secure: g.lowestPrice?.uninterruptablePrice ?? 0,
          community: g.lowestPrice?.minimumBidPrice ?? 0,
        };
      }
      setLivePrices(map);
      // Filter to GPUs that support the selected cloud type, sort by VRAM desc
      // Prefer GPUs with a non-zero price (available now), but show all supported ones
      const supported = allGpus.filter((g) =>
        config.cloudType === "COMMUNITY" ? g.communityCloud : g.secureCloud
      );
      const hasPrice = (g: typeof supported[0]) =>
        config.cloudType === "COMMUNITY"
          ? (g.lowestPrice?.minimumBidPrice ?? 0) > 0
          : (g.lowestPrice?.uninterruptablePrice ?? 0) > 0;
      setLiveGpuTypes(
        [...supported].sort((a, b) => {
          // Available (non-zero price) first, then by VRAM desc
          const aPriced = hasPrice(a) ? 1 : 0;
          const bPriced = hasPrice(b) ? 1 : 0;
          if (bPriced !== aPriced) return bPriced - aPriced;
          return b.memoryInGb - a.memoryInGb;
        })
      );
    } catch (err) {
      log(`Price fetch error: ${err}`);
    }
    setFetchingPrices(false);
  };

  // Re-fetch GPU list when volume selection or cloud type changes
  useEffect(() => {
    if (hasApiKey) fetchPrices();
  }, [config.networkVolumeId, config.cloudType]);

  const searchModels = async (query = modelQuery) => {
    if (!query.trim()) return;
    setModelLoading(true);
    setModelOpen(false);
    setModelResults([]);

    const q = encodeURIComponent(query.trim());

    const [civitaiRes, hfRes] = await Promise.allSettled([
      fetch(`https://civitai.com/api/v1/models?query=${q}&types=Checkpoint&limit=8`)
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((data: { items: Array<{ id: number; name: string; modelVersions: Array<{ id: number; name: string; files: Array<{ name: string; sizeKB: number; downloadUrl: string; primary?: boolean }> }> }> }) =>
          (data.items ?? []).flatMap((model): SearchResult[] => {
            const version = model.modelVersions?.[0];
            if (!version) return [];
            const file = version.files.find((f) => f.primary) ?? version.files[0];
            if (!file) return [];
            const sizeMB = Math.round(file.sizeKB / 1024);
            const sizeStr = sizeMB > 1024 ? `${(sizeMB / 1024).toFixed(1)}GB` : `${sizeMB}MB`;
            return [{ source: "civitai", label: model.name, sublabel: `${version.name} · ${sizeStr}`, downloadUrl: file.downloadUrl }];
          })
        ),
      fetch(`https://huggingface.co/api/models?search=${q}&pipeline_tag=text-to-image&sort=downloads&limit=8&full=true`)
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((data: Array<{ id: string; siblings?: Array<{ rfilename: string; size?: number }> }>) =>
          (data ?? []).flatMap((model): SearchResult[] => {
            const stFile = (model.siblings ?? []).find((s) => s.rfilename.endsWith(".safetensors"))
              ?? (model.siblings ?? []).find((s) => s.rfilename.endsWith(".ckpt"));
            if (!stFile) return [];
            const sizeMB = stFile.size ? Math.round(stFile.size / 1024 / 1024) : null;
            const sizeStr = sizeMB ? (sizeMB > 1024 ? `${(sizeMB / 1024).toFixed(1)}GB` : `${sizeMB}MB`) : "";
            return [{ source: "huggingface", label: model.id, sublabel: [stFile.rfilename, sizeStr].filter(Boolean).join(" · "), downloadUrl: `https://huggingface.co/${model.id}/resolve/main/${stFile.rfilename}` }];
          })
        ),
    ]);

    const combined: SearchResult[] = [
      ...(civitaiRes.status === "fulfilled" ? civitaiRes.value : []),
      ...(hfRes.status === "fulfilled" ? hfRes.value : []),
    ];

    setModelResults(combined);
    setModelOpen(true);
    if (combined.length === 0) log("No results found on CivitAI or HuggingFace.");
    setModelLoading(false);
  };

  const selectModel = (result: SearchResult) => {
    setConfig({ baseModelDownloadUrl: result.downloadUrl });
    setModelSelected(`${result.label}${result.source === "huggingface" ? " (HF)" : ""}`);
    setModelOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader
        title="RunPod Launcher"
        subtitle="Package dataset, launch Kohya training pod, monitor progress"
        actions={
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-ghost" onClick={() => open("https://www.runpod.io/console/pods")}>
              <ExternalLink size={12} style={{ display: "inline", marginRight: "5px" }} />
              Console
            </button>
            <button className="btn-ghost" onClick={refreshPods}>
              <RefreshCw size={12} style={{ display: "inline", marginRight: "5px" }} />
              Refresh Pods
            </button>
          </div>
        }
      />

      {/* Pipeline flow indicator — shown once pod is launched */}
      {pipelineStep >= 0 && (
        <div style={{
          padding: "10px 24px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-1)",
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
        }}>
          {["Create pod", "Upload dataset", "Get checkpoint", "Training", "Download LoRA", "Done"].map((label, i) => {
            const complete = pipelineStep > i;
            const active = pipelineStep === i;
            return (
              <div key={i} style={{ display: "contents" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", flexShrink: 0, width: "72px" }}>
                  <div style={{
                    width: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    background: complete ? "rgba(106,191,138,0.15)" : active ? "var(--accent-glow)" : "var(--bg-2)",
                    border: `1.5px solid ${complete ? "#6abf8a" : active ? "var(--accent-bright)" : "var(--border)"}`,
                    color: complete ? "#6abf8a" : active ? "var(--accent-bright)" : "var(--text-muted)",
                    position: "relative",
                    transition: "all 0.3s",
                    flexShrink: 0,
                  }}>
                    {complete ? "✓" : i + 1}
                    {active && (
                      <div style={{
                        position: "absolute",
                        inset: "-4px",
                        borderRadius: "50%",
                        border: "1px solid var(--accent-dim)",
                        animation: "pulse 2s infinite",
                        pointerEvents: "none",
                      }} />
                    )}
                  </div>
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    color: complete ? "#6abf8a" : active ? "var(--accent-bright)" : "var(--text-muted)",
                    textAlign: "center",
                    lineHeight: "1.3",
                    transition: "color 0.3s",
                  }}>
                    {label}
                  </div>
                </div>
                {i < 5 && (
                  <div style={{
                    flex: 1,
                    height: "1px",
                    background: complete ? "#6abf8a" : "var(--border)",
                    marginTop: "13px",
                    minWidth: "4px",
                    transition: "background 0.3s",
                  }} />
                )}
              </div>
            );
          })}
        </div>
      )}

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

          {/* Network Volume */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
              <div className="section-label" style={{ margin: 0 }}>Network Volume</div>
              <button className="btn-ghost" onClick={fetchVolumes} disabled={fetchingVolumes || !hasApiKey} style={{ padding: "2px 8px", fontSize: "10px" }}>
                <RefreshCw size={10} style={{ display: "inline", marginRight: "4px" }} />
                {fetchingVolumes ? "…" : "Refresh"}
              </button>
            </div>
            {!hasApiKey ? (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>Add RunPod API key in Settings.</div>
            ) : networkVolumes.length === 0 ? (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
                No volumes found.{" "}
                <span
                  onClick={() => open("https://www.runpod.io/console/user/storage")}
                  style={{ color: "var(--accent-bright)", cursor: "pointer", textDecoration: "underline" }}
                >Create one on RunPod</span>
              </div>
            ) : (
              networkVolumes.map((v) => {
                const selected = config.networkVolumeId === v.id;
                const contents = settings.volumeContents?.[v.id];
                return (
                  <div
                    key={v.id}
                    onClick={() => setConfig({ networkVolumeId: selected ? "" : v.id })}
                    style={{
                      padding: "8px 10px", marginTop: "4px", borderRadius: "5px", cursor: "pointer",
                      background: selected ? "var(--accent-glow)" : "var(--bg-2)",
                      border: `1px solid ${selected ? "var(--accent-dim)" : "var(--border)"}`,
                      transition: "all 0.1s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: selected ? "var(--accent-bright)" : "var(--text-primary)" }}>{v.name}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: selected ? "var(--accent-bright)" : "var(--text-muted)" }}>{v.size}GB · {v.dataCenterId}</div>
                    </div>
                    {contents && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: selected ? "var(--accent-bright)" : "var(--text-muted)", marginTop: "3px", opacity: 0.8 }}>
                        Last upload: {contents.datasetKey} · {new Date(contents.uploadedAt).toLocaleDateString()}
                      </div>
                    )}
                    {selected && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "3px", opacity: 0.7 }}>
                        Pods will launch in {v.dataCenterId} only
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* GPU selection */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div className="section-label" style={{ margin: 0 }}>GPU</div>
              <div style={{ display: "flex", gap: "6px" }}>
                {bestValueGpuId && bestValueGpuId.id !== config.gpuTypeId && (
                  <button
                    className="btn-ghost"
                    onClick={() => setConfig({ gpuTypeId: bestValueGpuId.id })}
                    style={{ padding: "2px 8px", fontSize: "10px", color: "var(--green)", borderColor: "var(--green)" }}
                  >
                    Select best
                  </button>
                )}
                <button className="btn-ghost" onClick={fetchPrices} disabled={fetchingPrices} style={{ padding: "2px 8px", fontSize: "10px" }}>
                  <RefreshCw size={10} style={{ display: "inline", marginRight: "4px" }} />
                  {fetchingPrices ? "Fetching…" : "Refresh Prices"}
                </button>
              </div>
            </div>
            {(liveGpuTypes
              ? liveGpuTypes.filter((g) => config.cloudType === "COMMUNITY" ? g.communityCloud : g.secureCloud)
              : RECOMMENDED_GPUS.map((g) => ({ id: g.id, displayName: g.label, memoryInGb: g.vram, secureCloud: true, communityCloud: true }))
            ).map((gpu) => {
              const price = livePrices?.[gpu.id];
              const priceStr = price
                ? config.cloudType === "COMMUNITY"
                  ? `$${price.community.toFixed(2)}/hr spot`
                  : `$${price.secure.toFixed(2)}/hr`
                : null;
              const selected = config.gpuTypeId === gpu.id;
              const isBest = bestValueGpuId?.id === gpu.id;
              return (
                <div
                  key={gpu.id}
                  onClick={() => setConfig({ gpuTypeId: gpu.id })}
                  style={{
                    padding: "8px 10px",
                    marginTop: "4px",
                    borderRadius: "5px",
                    cursor: "pointer",
                    background: selected ? "var(--accent-glow)" : "var(--bg-2)",
                    border: `1px solid ${selected ? "var(--accent-dim)" : isBest ? "var(--green)" : "var(--border)"}`,
                    transition: "all 0.1s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Row 1: name + price */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: selected ? "var(--accent-bright)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {gpu.displayName}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: selected ? "var(--accent-bright)" : "var(--text-muted)", flexShrink: 0 }}>
                        {gpu.memoryInGb}GB{priceStr ? ` · ${priceStr}` : ""}
                      </div>
                    </div>
                    {/* Row 2: badges (only when present) */}
                    {(isBest || config.networkVolumeId) && (
                      <div style={{ display: "flex", gap: "5px", marginTop: "4px", flexWrap: "wrap" }}>
                        {isBest && (
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--green)", letterSpacing: "0.06em", textTransform: "uppercase", padding: "1px 5px", borderRadius: "3px", background: "rgba(74,154,106,0.12)", border: "1px solid var(--green)" }}>
                            best value · ~${bestValueGpuId.cost.toFixed(2)}
                          </div>
                        )}
                        {config.networkVolumeId && (
                          dcGpuIds.has(gpu.id) ? (
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--green)", padding: "1px 5px", borderRadius: "3px", background: "rgba(74,154,106,0.10)", border: "1px solid rgba(74,154,106,0.3)" }}>
                              cached
                            </div>
                          ) : (
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", padding: "1px 5px", borderRadius: "3px", background: "var(--bg-3)", border: "1px solid var(--border)" }}>
                              ↓ dl model
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cloud type */}
          <div style={{ marginBottom: "16px" }}>
            <div className="section-label">Cloud Type</div>
            <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
              {(["ALL", "SECURE", "COMMUNITY"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setConfig({ cloudType: t })}
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
              ALL = cheapest available (community first). SECURE = guaranteed. COMMUNITY = spot only.
            </div>
          </div>

          {/* Training hyperparams */}
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
              <div className="section-label" style={{ margin: 0 }}>Training Hyperparameters</div>
              <div style={{ display: "flex", gap: "4px" }}>
                {(["SDXL", "SD 1.5"] as const).map((label) => {
                  const isXL = label === "SDXL";
                  const active = config.sdxl === isXL;
                  return (
                    <button
                      key={label}
                      onClick={() => setConfig({ sdxl: isXL })}
                      style={{
                        padding: "2px 8px", fontSize: "10px", cursor: "pointer",
                        background: active ? "var(--bg-4)" : "var(--bg-2)",
                        border: `1px solid ${active ? "var(--accent-dim)" : "var(--border)"}`,
                        color: active ? "var(--accent-bright)" : "var(--text-muted)",
                        borderRadius: "4px",
                        fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.06em",
                      }}
                    >{label}</button>
                  );
                })}
              </div>
            </div>
            {/* Optimizer selector */}
            <div style={{ display: "flex", gap: "4px", marginTop: "6px", marginBottom: "8px" }}>
              {(["AdamW8bit", "Prodigy", "DAdaptAdam"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setConfig({ optimizer: opt })}
                  style={{
                    flex: 1, padding: "4px 6px", fontSize: "10px", cursor: "pointer",
                    background: config.optimizer === opt ? "var(--bg-4)" : "var(--bg-2)",
                    border: `1px solid ${config.optimizer === opt ? "var(--accent-dim)" : "var(--border)"}`,
                    color: config.optimizer === opt ? "var(--accent-bright)" : "var(--text-muted)",
                    borderRadius: "4px",
                    fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em",
                  }}
                >{opt}</button>
              ))}
            </div>
            {(config.optimizer === "Prodigy" || config.optimizer === "DAdaptAdam") && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--accent-dim)", marginBottom: "6px", lineHeight: 1.5 }}>
                Adaptive optimizer — LR auto-managed at 1.0 · alpha forced to 1 · scheduler set to constant
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "6px" }}>
              {[
                { label: "Steps", key: "steps" as const, type: "number" },
                { label: "LR", key: "learningRate" as const, type: "text" },
                { label: "Network Dim", key: "networkDim" as const, type: "number" },
                { label: "Resolution", key: "resolution" as const, type: "number" },
                { label: "Container Disk (GB)", key: "containerDiskInGb" as const, type: "number" },
              ].map(({ label, key, type }) => {
                const suggestedSteps = approved.length > 0
                  ? Math.max(500, Math.min(4000, Math.round(approved.length * 100 / 100) * 100))
                  : null;
                return (
                  <div key={key}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginBottom: "3px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                    <input
                      type={type}
                      style={{ width: "100%", opacity: key === "learningRate" && (config.optimizer === "Prodigy" || config.optimizer === "DAdaptAdam") ? 0.4 : 1 }}
                      value={config[key]}
                      onChange={(e) => setConfig({ [key]: type === "number" ? parseInt(e.target.value) || 0 : e.target.value })}
                      disabled={key === "learningRate" && (config.optimizer === "Prodigy" || config.optimizer === "DAdaptAdam")}
                    />
                    {key === "steps" && suggestedSteps && config.steps !== suggestedSteps && (
                      <div
                        onClick={() => setConfig({ steps: suggestedSteps })}
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
            <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "16px" }}>
              {[
                { label: "Final LoRA only", value: false },
                { label: "Final + intermediates", value: true },
              ].map(({ label, value }) => (
                <label key={label} style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: "11px", color: downloadIntermediates === value ? "var(--text)" : "var(--text-muted)" }}>
                  <input
                    type="radio"
                    checked={downloadIntermediates === value}
                    onChange={() => setDownloadIntermediates(value)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  {label}
                </label>
              ))}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", letterSpacing: "0.04em" }}>auto-download on complete</span>
              <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: "11px", color: autoTerminate ? "var(--text)" : "var(--text-muted)", marginLeft: "8px" }}>
                <input
                  type="checkbox"
                  checked={autoTerminate}
                  onChange={(e) => setAutoTerminate(e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                />
                terminate pod after download
              </label>
            </div>

            <div style={{ marginTop: "12px" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginBottom: "4px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Base Model — Search <span style={{ opacity: 0.6 }}>(CivitAI → HuggingFace)</span>
              </div>
              {/* Search row */}
              <div ref={modelDropdownRef} style={{ position: "relative" }}>
              <div style={{ display: "flex", gap: "4px" }}>
                <input
                  style={{ flex: 1, fontSize: "11px" }}
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") searchModels(); if (e.key === "Escape") setModelOpen(false); }}
                  placeholder="e.g. illustriousXL"
                />
                <button
                  className="btn-ghost"
                  onClick={() => searchModels()}
                  disabled={modelLoading}
                  style={{ padding: "4px 8px", fontSize: "10px", flexShrink: 0 }}
                >
                  {modelLoading
                    ? <RefreshCw size={10} style={{ animation: "spin 1s linear infinite" }} />
                    : <Search size={10} />}
                </button>
              </div>
              {/* Results dropdown */}
              {modelOpen && modelResults.length > 0 && (
                <div style={{
                  marginTop: "4px",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                  borderRadius: "5px",
                  maxHeight: "220px",
                  overflowY: "auto",
                }}>
                  {modelResults.map((result, i) => (
                    <div
                      key={i}
                      onClick={() => selectModel(result)}
                      style={{
                        padding: "7px 10px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--border)",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-3)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.label}</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "8px", color: result.source === "huggingface" ? "#f5a623" : "var(--accent-bright)", flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          {result.source === "huggingface" ? "HF" : "CivitAI"}
                        </div>
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginTop: "2px" }}>{result.sublabel}</div>
                    </div>
                  ))}
                </div>
              )}
              {modelOpen && modelResults.length === 0 && (
                <div style={{ marginTop: "4px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", padding: "6px 0" }}>No results.</div>
              )}
              </div>{/* end modelDropdownRef */}
              {/* Selected model display */}
              {modelSelected && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                  <div style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--green)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    ✓ {modelSelected}
                  </div>
                  <button
                    className="btn-ghost"
                    onClick={() => { setModelSelected(""); setConfig({ baseModelDownloadUrl: "" }); }}
                    style={{ padding: "2px 4px", flexShrink: 0 }}
                    title="Clear selection"
                  ><X size={9} /></button>
                </div>
              )}
              {/* Raw URL — editable fallback */}
              <div style={{ marginTop: "4px" }}>
                <input
                  style={{ width: "100%", fontSize: "10px", opacity: 0.7 }}
                  value={config.baseModelDownloadUrl}
                  onChange={(e) => { setConfig({ baseModelDownloadUrl: e.target.value }); setModelSelected(""); }}
                  placeholder="https://… (or paste URL directly)"
                />
              </div>
            </div>
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", marginBottom: "3px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Base Model — Local Path <span style={{ opacity: 0.6 }}>(fallback, slow for large files)</span>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  style={{ flex: 1, fontSize: "11px" }}
                  value={config.baseModelLocalPath}
                  onChange={(e) => setConfig({ baseModelLocalPath: e.target.value })}
                  placeholder="/path/to/model.safetensors"
                />
                <button
                  className="btn-ghost"
                  onClick={async () => {
                    const p = await invoke<string | null>("pick_file", { filterName: "Model", extensions: ["safetensors", "ckpt", "pt"] });
                    if (p) setConfig({ baseModelLocalPath: p });
                  }}
                  style={{ padding: "4px 8px", fontSize: "10px", flexShrink: 0 }}
                >Browse</button>
              </div>
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
            {existingZip ? (
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="btn-ghost"
                  disabled={phase === "packaging" || phase === "training"}
                  onClick={packageDataset}
                  style={{ flex: 1 }}
                >
                  <Upload size={12} style={{ display: "inline", marginRight: "5px" }} />
                  {phase === "packaging" ? "Packaging…" : "Repackage Dataset"}
                </button>
                <div style={{ display: "flex", alignItems: "center", padding: "0 8px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--green)", background: "rgba(74,154,106,0.1)", border: "1px solid var(--green)", borderRadius: "4px", whiteSpace: "nowrap" }}>
                  ✓ ready
                </div>
              </div>
            ) : (
              <button
                className={phase === "packaging" ? "btn-ghost" : "btn-primary"}
                onClick={packageDataset}
                disabled={phase === "packaging" || phase === "training"}
              >
                <Upload size={12} style={{ display: "inline", marginRight: "5px" }} />
                {phase === "packaging" ? "Packaging…" : "1. Package Dataset"}
              </button>
            )}

            <button
              className="btn-primary"
              onClick={launchPod}
              disabled={!zipPath || !!pod || phase === "packaging"}
              style={{ opacity: !zipPath || !!pod ? 0.4 : 1 }}
            >
              <Play size={12} style={{ display: "inline", marginRight: "5px" }} />
              2. Launch Training Pod
            </button>

          </div>
        </div>

        {/* Right: log + pod status */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Detected running pods (shown when not already linked) */}
          {!pod && activePods.length > 0 && (
            <div style={{
              padding: "10px 20px",
              borderBottom: "1px solid var(--border)",
              background: "rgba(74,154,106,0.06)",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--green)", animation: "pulse 2s infinite", flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--green)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {activePods.length} pod{activePods.length !== 1 ? "s" : ""} already running
                </span>
              </div>
              {activePods.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                  <div style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)" }}>
                    {p.name || p.id.slice(0, 12)}…
                    {p.runtime?.uptimeInSeconds ? ` · ${Math.floor(p.runtime.uptimeInSeconds / 60)}m uptime` : ""}
                    {p.costPerHr ? ` · $${p.costPerHr.toFixed(3)}/hr` : ""}
                  </div>
                  <button
                    onClick={() => linkPod(p)}
                    style={{
                      padding: "3px 10px", fontSize: "10px", cursor: "pointer",
                      background: "rgba(74,154,106,0.15)", border: "1px solid var(--green)",
                      color: "var(--green)", borderRadius: "3px",
                      fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.05em",
                      flexShrink: 0,
                    }}
                  >Link</button>
                </div>
              ))}
            </div>
          )}

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
                  background: pod.status === "RUNNING" && jupyterUrl ? "var(--green)" : pod.status === "EXITED" ? "var(--red)" : "var(--accent)",
                  flexShrink: 0,
                  ...(pod.status === "RUNNING" ? { animation: "pulse 2s infinite" } : {}),
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                    Pod {pod.id.slice(0, 8)}… — <span style={{ color: pod.status === "RUNNING" ? "var(--green)" : "var(--text-secondary)" }}>
                      {pod.status === "RUNNING" && !jupyterUrl ? "LAUNCHING" : pod.status}
                    </span>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
                    ${pod.costPerHr?.toFixed(3) ?? "?"} USD/hr
                    {pod.runtime?.uptimeInSeconds ? ` · ${Math.floor(pod.runtime.uptimeInSeconds / 60)}m uptime` : ""}
                    {polling ? " · polling every 15s" : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  {jupyterUrl && (
                    <button
                      onClick={() => open(jupyterUrl)}
                      className="btn-primary"
                      style={{ padding: "5px 12px", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px" }}
                      title={jupyterUrl}
                    >
                      <ExternalLink size={11} />
                      Open Jupyter
                    </button>
                  )}
                  <button
                    onClick={terminateCurrentPod}
                    style={{ padding: "5px 12px", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", background: "var(--red-dim)", border: "1px solid var(--red)", color: "#d47070", borderRadius: "4px", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em" }}
                  >
                    <Square size={11} />
                    Terminate
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Log terminal */}
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-0)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            lineHeight: 1.7,
            minHeight: 0,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "16px 20px 12px",
              color: "var(--text-muted)",
              flexShrink: 0,
            }}>
              <Terminal size={12} />
              <span style={{ letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "9px", flex: 1 }}>
                Activity Log
              </span>
              <button className="btn-ghost" onClick={() => setAutoScroll(a => !a)} style={{ padding: "1px 6px", fontSize: "9px", color: autoScroll ? "var(--accent-bright)" : undefined }}>
                Auto-scroll
              </button>
              {logs.length > 0 && (
                <>
                  <button className="btn-ghost" onClick={() => { navigator.clipboard.writeText(logs.join("\n")); setLogCopied(true); setTimeout(() => setLogCopied(false), 2000); }} style={{ padding: "1px 6px", fontSize: "9px", color: logCopied ? "var(--green)" : undefined }}>
                    {logCopied ? "Copied!" : "Copy"}
                  </button>
                  <button className="btn-ghost" onClick={() => { clearRunpodLogs(); log("Log cleared."); }} style={{ padding: "1px 6px", fontSize: "9px" }}>
                    Clear
                  </button>
                </>
              )}
              {logFilePath && (
                <span style={{ fontSize: "9px", opacity: 0.5, fontFamily: "var(--font-mono)" }} title={logFilePath}>
                  → runpod.log
                </span>
              )}
            </div>
            <div ref={logScrollRef} style={{ flex: 1, overflow: "auto", padding: "0 20px 16px" }}>
              {uploadStatus && (
                <div style={{ color: "var(--accent-bright)", display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <RefreshCw size={10} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                  {uploadStatus}
                </div>
              )}
              {logs.length === 0 && !uploadStatus && (
                <div style={{ color: "var(--text-muted)" }}>
                  Ready. Package your dataset to begin.
                </div>
              )}
              {logs.map((line, i) => (
                <div key={i} style={{
                  color: logColor(line),
                }}>
                  {line || <br />}
                </div>
              ))}
              {downloadFailed && jupyterUrl && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px", marginTop: "8px",
                  padding: "7px 10px", borderRadius: "5px",
                  position: "sticky", bottom: 0,
                  background: "rgba(212,112,112,0.12)", border: "1px solid rgba(212,112,112,0.3)",
                  backdropFilter: "blur(4px)",
                }}>
                  <AlertTriangle size={12} style={{ color: "#d47070", flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "#d47070", flex: 1 }}>
                    Download failed — training output still on pod
                  </span>
                  <button
                    className="btn-ghost"
                    style={{ padding: "3px 10px", fontSize: "10px", color: "var(--accent-bright)", borderColor: "var(--accent-dim)" }}
                    onClick={() => downloadOutputs(jupyterUrl)}
                  >
                    Retry Download
                  </button>
                </div>
              )}
              {trainingHalted && jupyterUrl && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px", marginTop: "8px",
                  padding: "7px 10px", borderRadius: "5px",
                  position: "sticky", bottom: 0,
                  background: "rgba(212,112,112,0.12)", border: "1px solid rgba(212,112,112,0.3)",
                  backdropFilter: "blur(4px)",
                }}>
                  <AlertTriangle size={12} style={{ color: "#d47070", flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "#d47070", flex: 1 }}>
                    Training halted
                  </span>
                  <button
                    className="btn-ghost"
                    style={{ padding: "3px 10px", fontSize: "10px", color: "var(--accent-bright)", borderColor: "var(--accent-dim)" }}
                    onClick={() => { setTrainingHalted(false); checkAndResume(jupyterUrl); startPolling(pod?.id ?? ""); }}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
