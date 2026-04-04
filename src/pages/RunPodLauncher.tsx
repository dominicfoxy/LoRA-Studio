import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Upload, Play, Square, RefreshCw, Terminal, AlertTriangle, ExternalLink, Search, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useStore } from "../store";
import {
  listGpuTypes, fetchGpuPrices, createPod, getPod, terminatePod, listPods, getSshInfo,
  listNetworkVolumes, checkRunpodctl, installRunpodctl, setupSshKey,
  sshIsReady, sshRunCommand, sshUploadFile, sshDownloadFile,
  RECOMMENDED_GPUS, KOHYA_POD_TEMPLATE, generateKohyaConfig, gpuTrainingFlags,
  Pod, NetworkVolume, GpuPrice,
} from "../lib/runpod";

interface SearchResult {
  source: "civitai" | "huggingface";
  label: string;
  sublabel: string;
  downloadUrl: string;
}


type Phase = "config" | "packaging" | "uploading" | "training" | "done";

function logColor(line: string): string {
  if (/error|traceback|exception|failed|failure|abort/i.test(line)) return "var(--red-bright)";
  if (/warning|warn:|extracting/i.test(line)) return "#d4a04a";
  if (/saved|complete|finished|terminated|downloaded|uploaded|extracted|success|done\b|all done|zipped|created|linked|✓/i.test(line)) return "#6abf8a";
  if (/step \d+\/\d+|uploading|launching|packaging|downloading|training|epoch \d+|waiting|it\/s|s\/it/i.test(line)) return "var(--accent-bright)";
  if (line.startsWith("[")) return "var(--text-secondary)";
  return "var(--text-muted)";
}

// Strip characters unsafe in bash double-quoted strings from a filename
function sanitizeShellArg(s: string): string {
  return s.replace(/["$`\\]/g, "");
}

// Module-level state — survives HMR remounts (React Fast Refresh doesn't re-run module scope)
let _podPollId: ReturnType<typeof setInterval> | null = null;
let _logPollId: ReturnType<typeof setInterval> | null = null;
let _sshWaitId: ReturnType<typeof setInterval> | null = null;
let _uploadInProgress = false;
// Track which pod we've already reconnected to — prevents re-running reconnect on tab switches
let _connectedPodId = "";

export default function RunPodLauncher() {
  const { character, images, settings, setSettings, training: config, updateTraining: setConfig, runpodLogs: logs, addRunpodLog, clearRunpodLogs, runpodActivePodId, runpodActiveSshHost, runpodActiveSshPort, setRunpodActivePodId, setRunpodActiveSshHost, setRunpodActiveSshPort } = useStore();
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
  const [sshHost, setSshHostLocal] = useState(runpodActiveSshHost || "");
  const [sshPort, setSshPortLocal] = useState(runpodActiveSshPort || 0);
  const setSshInfo = (host: string, port: number) => {
    setSshHostLocal(host); setSshPortLocal(port);
    setRunpodActiveSshHost(host); setRunpodActiveSshPort(port);
  };
  const [liveGpuTypes, setLiveGpuTypes] = useState<Array<{ id: string; displayName: string; memoryInGb: number }> | null>(null);
  const [livePrices, setLivePrices] = useState<Map<string, GpuPrice> | null>(null);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [runpodctlStatus, setRunpodctlStatus] = useState<"checking" | "missing" | "installing" | "ready">("checking");
  const [sshKeyState, setSshKeyState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [networkVolumes, setNetworkVolumes] = useState<NetworkVolume[]>([]);
  const [fetchingVolumes, setFetchingVolumes] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Starts a 1s elapsed-time ticker in uploadStatus. Returns a stop function.
  const startTicker = (label: string) => {
    const start = Date.now();
    setUploadStatus(`${label} (0s)`);
    const id = setInterval(() => {
      const s = Math.round((Date.now() - start) / 1000);
      const t = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
      setUploadStatus(`${label} (${t})`);
    }, 1000);
    return () => clearInterval(id);
  };
  const [trainingHalted, setTrainingHalted] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelResults, setModelResults] = useState<SearchResult[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSelected, setModelSelected] = useState("");
  const [podUptimeSec, setPodUptimeSec] = useState<number | null>(null);
  const podUptimeRef = useRef<number | null>(null);
  const uptimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [logCopied, setLogCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logScrollRef = useRef<HTMLDivElement>(null);
  // Effective volume ID for the current training run (null when GPU is outside volume's DC)
  const effectiveVolumeIdRef = useRef<string | null>(null);
  // When true, poll tick uses checkAndResume instead of uploadToVolume after SSH ready
  const linkedPodRef = useRef(false);
  const [downloadIntermediates, setDownloadIntermediates] = useState(false);
  const downloadIntermediatesRef = useRef(false);
  useEffect(() => { downloadIntermediatesRef.current = downloadIntermediates; }, [downloadIntermediates]);
  const [autoTerminate, setAutoTerminate] = useState(true);
  const autoTerminateRef = useRef(true);
  useEffect(() => { autoTerminateRef.current = autoTerminate; }, [autoTerminate]);
  // Sync uptime ref from poll data (runs each time pod object updates)
  const podStatus = pod?.status;
  const polledUptime = pod?.runtime?.uptimeInSeconds;
  useEffect(() => {
    if (podStatus === "RUNNING") {
      if (polledUptime != null && polledUptime > 0) {
        podUptimeRef.current = polledUptime;
        setPodUptimeSec(polledUptime);
      } else if (podUptimeRef.current == null) {
        podUptimeRef.current = 0;
        setPodUptimeSec(0);
      }
    } else {
      podUptimeRef.current = null;
      setPodUptimeSec(null);
    }
  }, [podStatus, polledUptime]);

  // Tick uptime every second while pod is running (interval lifecycle separate from poll sync)
  useEffect(() => {
    if (podStatus !== "RUNNING") {
      if (uptimeIntervalRef.current) { clearInterval(uptimeIntervalRef.current); uptimeIntervalRef.current = null; }
      return;
    }
    uptimeIntervalRef.current = setInterval(() => {
      podUptimeRef.current = (podUptimeRef.current ?? 0) + 1;
      setPodUptimeSec(podUptimeRef.current);
    }, 1000);
    return () => { if (uptimeIntervalRef.current) { clearInterval(uptimeIntervalRef.current); uptimeIntervalRef.current = null; } };
  }, [podStatus]);

  // Check runpodctl availability on mount
  useEffect(() => {
    checkRunpodctl().then(ready => setRunpodctlStatus(ready ? "ready" : "missing"));
  }, []);

  // Clear all intervals on unmount to prevent accumulation across navigations
  useEffect(() => {
    return () => {
      if (_podPollId) { clearInterval(_podPollId); _podPollId = null; }
      if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
      if (_sshWaitId) { clearInterval(_sshWaitId); _sshWaitId = null; }
      _uploadInProgress = false;
      _connectedPodId = ""; // allow reconnect to re-fire on remount
    };
  }, []);

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


  const hasApiKey = !!settings.runpodApiKey;

  useEffect(() => {
    if (!hasApiKey) return;
    fetchVolumes();
    refreshPods();
  }, [hasApiKey]);

  // Check pod state on reconnect — skip re-uploading files already present and stable
  const checkAndResume = async (host: string, port: number, keyPath: string) => {
    const zipName = `${character.triggerWord}_dataset.zip`;
    const modelBaseName = sanitizeShellArg(
      (character.baseModel || "model.safetensors").replace(/\s*\[.*?\]\s*$/, "").trim().split(/[\\/]/).pop() || "model.safetensors"
    );

    log("Checking pod state before restart…");
    setUploadStatus("Checking pod state…");

    try {
      const [extractResult, manifestResult] = await Promise.allSettled([
        sshRunCommand(host, port, keyPath, "test -f /workspace/.extract_done && echo yes || echo no"),
        sshRunCommand(host, port, keyPath, "cat /workspace/.model_manifest 2>/dev/null || echo ''"),
      ]);

      const datasetReady = extractResult.status === "fulfilled" && (extractResult.value as string).trim() === "yes";
      const modelReady = manifestResult.status === "fulfilled" && !!(manifestResult.value as string).trim();

      if (datasetReady && modelReady) {
        const trainingDone = await sshRunCommand(host, port, keyPath, "test -f /workspace/.training_done && echo yes || echo no").catch(() => "no");
        if (trainingDone.trim() === "yes") {
          log("Training already completed — downloading instead of relaunching…");
          setPipelineStep(3);
          setUploadStatus(null);
          await downloadOutputs(host, port, keyPath);
          return;
        }
        // Check if training previously failed (log exists with failure marker but no .training_done)
        const logTail = await sshRunCommand(host, port, keyPath, "tail -5 /workspace/training.log 2>/dev/null || echo ''").catch(() => "");
        if (/training failed/i.test(logTail)) {
          log("Previous training failed — relaunching with current settings…");
          setUploadStatus(null);
          const vram = RECOMMENDED_GPUS.find(g => g.id === config.gpuTypeId)?.vram ?? 0;
          const gpuFlags = gpuTrainingFlags(vram, config.optimizer);
          launchTraining(host, port, keyPath, modelBaseName, gpuFlags);
          return;
        }
        log("Dataset and model on pod, training not yet complete — resuming log monitor…");
        setPipelineStep(3);
        setUploadStatus(null);
        startLogPolling(host, port, keyPath, 0);
        return;
      }

      if (!datasetReady) {
        // Check if zip is present and stable (size unchanged over ~10s)
        log("Dataset not yet extracted — checking zip status…");
        const size1 = (await sshRunCommand(host, port, keyPath, `stat -c%s /workspace/${zipName} 2>/dev/null || echo 0`).catch(() => "0")).trim();
        if (size1 && size1 !== "0") {
          await new Promise(r => setTimeout(r, 10000));
          const size2 = (await sshRunCommand(host, port, keyPath, `stat -c%s /workspace/${zipName} 2>/dev/null || echo 0`).catch(() => "0")).trim();
          if (size1 !== size2) {
            log(`Dataset zip still transferring (${size1} → ${size2} bytes) — not interrupting.`);
            setUploadStatus(null);
            startLogPolling(host, port, keyPath, 0);
            return;
          }
          log(`Dataset zip present and stable (${Number(size1).toLocaleString()} bytes) — skipping re-upload.`);
          setUploadStatus(null);
          uploadToVolume(host, port, keyPath, { skipZipUpload: true });
          return;
        }
      }

      setUploadStatus(null);
      log("Restarting upload…");
      uploadToVolume(host, port, keyPath);
    } catch {
      setUploadStatus(null);
      log("SSH not responding yet — waiting for pod to finish starting…");
      startSshWait(host, port, keyPath);
    }
  };

  // Reconnect to an active pod if we navigated away and came back
  useEffect(() => {
    if (!runpodActivePodId || !hasApiKey) return;
    if (_connectedPodId === runpodActivePodId) return;
    _connectedPodId = runpodActivePodId;
    getPod(apiKeyRef.current, runpodActivePodId).then((p) => {
      setPodLocal(p);
      setPhase("training");
      linkedPodRef.current = true;
      startPolling(runpodActivePodId);
      // If SSH info is already known, check training status
      if (runpodActiveSshHost && runpodActiveSshPort && settings.sshKeyPath) {
        const host = runpodActiveSshHost;
        const port = runpodActiveSshPort;
        const keyPath = settings.sshKeyPath;
        sshHostRef.current = host;
        setSshHostLocal(host);
        setSshPortLocal(port);
        log(`Reconnected to pod ${runpodActivePodId} — checking training status…`);
        sshRunCommand(host, port, keyPath, "test -f /workspace/.training_done && echo yes || echo no")
          .then((res) => {
            if (res.trim() === "yes") {
              log("Training already completed — starting download…");
              downloadOutputs(host, port, keyPath);
            } else {
              sshRunCommand(host, port, keyPath, "cat /workspace/training.log 2>/dev/null || echo ''")
                .then((content) => {
                  if (content.trim()) {
                    if (content.includes("training failed")) {
                      log("Training previously failed — use Retry to relaunch or Terminate to stop billing.");
                      setTrainingHalted(true);
                    } else if (content.includes("training complete")) {
                      log("Training already completed — starting download…");
                      downloadOutputs(host, port, keyPath);
                    } else {
                      log("Training already running — resuming log tail…");
                      startLogPolling(host, port, keyPath, content.split("\n").length);
                    }
                  } else {
                    log("Training log empty — restarting upload…");
                    uploadToVolume(host, port, keyPath);
                  }
                })
                .catch(() => checkAndResume(host, port, keyPath));
            }
          })
          .catch(() => checkAndResume(host, port, keyPath));
      }
    }).catch(() => {
      _connectedPodId = "";
      setRunpodActivePodId("");
      setRunpodActiveSshHost("");
      setRunpodActiveSshPort(0);
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

  // Infer stepsPerSec for any GPU by VRAM tier (used for estimatedTime display)
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
      const stopPackagingTicker = startTicker("Packaging dataset…");
      await invoke("zip_dataset", { datasetDir: character.outputDir, outputZip: zipOut });
      stopPackagingTicker();
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
    if (phase === "training") return; // guard against spam-clicks
    if (!settings.sshKeyPath) { log("Error: SSH key not configured — click Setup above first."); return; }
    linkedPodRef.current = false;

    _connectedPodId = "";
    setPhase("training");
    log("Launching RunPod pod...");

    try {
      // Always re-register SSH key before pod creation — ensures RunPod injects the correct key on startup
      try {
        const keyPath = await setupSshKey(settings.runpodApiKey);
        if (keyPath !== settings.sshKeyPath) setSettings({ sshKeyPath: keyPath });
      } catch (keyErr) {
        log(`SSH key registration warning: ${keyErr} — continuing with existing key`);
      }

      const selectedVol = networkVolumes.find((v) => v.id === config.networkVolumeId);
      // Volume attach: only if volume selected and GPU available in its DC (dcGpuIds may be empty)
      const useVolume = !!config.networkVolumeId;
      const dataCenterId = useVolume ? selectedVol?.dataCenterId : undefined;
      effectiveVolumeIdRef.current = useVolume ? config.networkVolumeId : null;

      const podSpec = {
        name: `lora-${character.triggerWord}-${Date.now()}`,
        ...KOHYA_POD_TEMPLATE,
        imageName: settings.dockerImage || "ashleykza/kohya:latest",
        gpuTypeId: config.gpuTypeId,
        cloudType: config.cloudType,
        containerDiskInGb: config.containerDiskInGb,
        volumeInGb: useVolume ? 5 : 50,
        ...(useVolume ? { networkVolumeId: config.networkVolumeId } : { volumeMountPath: undefined }),
        ...(dataCenterId ? { dataCenterId } : {}),
        env: [],
      };
      log(`Spec: gpu=${podSpec.gpuTypeId} cloud=${podSpec.cloudType} disk=${podSpec.containerDiskInGb}GB vol=${podSpec.volumeInGb}GB dc=${dataCenterId ?? "any"} image=${podSpec.imageName}`);
      const newPod = await createPod(settings.runpodApiKey, podSpec);
      setPod(newPod);
      log(`Pod created: ${newPod.id} (${newPod.status})`);
      log(`Cost: $${newPod.costPerHr?.toFixed(3) ?? "?"}/hr`);
      log(`Waiting for pod to start and trainer to launch…`);
      log(`Note: pod startup typically takes 3–6 minutes. If it seems stuck, it's probably fine — RunPod can be slow to provision.`);
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

  const sshHostRef = useRef("");

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

  // Start polling SSH readiness — clears any existing wait first (prevents duplicates across remounts)
  const startSshWait = (host: string, port: number, keyPath: string, opts: { checkFirst?: boolean } = {}) => {
    if (_sshWaitId) { clearInterval(_sshWaitId); _sshWaitId = null; }
    // Set the ref immediately so the pod poll tick's !sshHostRef.current guard
    // prevents a duplicate call before the first ssh_is_ready check fires
    sshHostRef.current = host;
    let attempts = 0;
    let checking = false;
    log(`Waiting for SSH to come up…`);
    const stopSshTicker = startTicker("Waiting for SSH…");

    const check = async () => {
      if (checking) return;
      checking = true;
      attempts++;
      try {
        const ready = await sshIsReady(host, port, keyPath);
        if (attempts <= 3 || attempts % 10 === 0) log(`SSH probe #${attempts} → ${ready ? "ready" : "not ready yet"} (${host}:${port})`);
        if (ready) {
          if (_sshWaitId) { clearInterval(_sshWaitId); _sshWaitId = null; }
          stopSshTicker();
          if (opts.checkFirst) {
            log(`SSH ready — checking pod state…`);
            checkAndResume(host, port, keyPath);
          } else {
            log(`SSH ready — starting upload…`);
            uploadToVolume(host, port, keyPath);
          }
        } else if (attempts >= 120) {
          if (_sshWaitId) { clearInterval(_sshWaitId); _sshWaitId = null; }
          stopSshTicker();
          log(`SSH unreachable after 10 min — pod may still be starting. Try: ssh -p ${port} root@${host}`);
        }
      } finally {
        checking = false;
      }
    };

    check();
    _sshWaitId = setInterval(check, 5000);
  };

  const applySensibleDefaults = () => {
    const suggestedSteps = approved.length > 0
      ? config.sdxl
        ? Math.max(1500, Math.min(3000, Math.round(approved.length * 60 / 100) * 100))
        : Math.max(1000, Math.min(2000, Math.round(approved.length * 40 / 100) * 100))
      : config.sdxl ? 1500 : 1200;
    setConfig({
      optimizer: "AdamW8bit",
      unetLr: config.sdxl ? "5e-5" : "1e-4",
      textEncoderLr: config.sdxl ? "1e-5" : "5e-5",
      networkDim: config.sdxl ? 32 : 64,
      networkAlpha: config.sdxl ? 16 : 32,
      resolution: config.sdxl ? 1024 : 512,
      noiseOffset: config.sdxl ? 0 : 0.0357,
      minSnrGamma: 5,
      // vPrediction intentionally not set — it's model-specific and can't be inferred
      // from SDXL/SD1.5 alone (NoobAI-XL, Pony variants, 3wolfmond all require it)
      steps: suggestedSteps,
      prodigyDCoef: 2,
      weightDecay: 0.01,
      containerDiskInGb: 40,
    });
  };

  // Auto-apply sensible defaults when EZ mode is enabled
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (settings.ezMode) applySensibleDefaults(); }, [settings.ezMode]);

  const buildTrainingCommand = () => {
    const previewModelBaseName = sanitizeShellArg(
      (character.baseModel || "model.safetensors")
        .replace(/\s*\[.*?\]\s*$/, "").trim().split(/[\\/]/).pop() || "model.safetensors"
    );
    const selectedVram = RECOMMENDED_GPUS.find(g => g.id === config.gpuTypeId)?.vram ?? 0;
    const previewGpuFlags = gpuTrainingFlags(selectedVram, config.optimizer);
    const isAdaptive = config.optimizer === "Prodigy" || config.optimizer === "DAdaptAdam";
    const networkAlpha = isAdaptive ? 1 : config.networkAlpha;
    const lrFlagStr = isAdaptive
      ? "--learning_rate 1.0"
      : `--unet_lr ${config.unetLr} --text_encoder_lr ${config.textEncoderLr}`;
    const lrScheduler = isAdaptive ? "constant" : "cosine_with_restarts";
    const lrWarmupSteps = isAdaptive ? 0 : Math.round(config.steps * 0.05);
    const lrWarmupFlag = isAdaptive ? "" : `--lr_warmup_steps ${lrWarmupSteps}`;
    const optimizerArgs = config.optimizer === "Prodigy"
      ? `--optimizer_args "decouple=True" "weight_decay=${config.weightDecay}" "d_coef=${config.prodigyDCoef}" "use_bias_correction=True" "safeguard_warmup=True"`
      : config.optimizer === "DAdaptAdam"
      ? `--optimizer_args "decouple=True" "weight_decay=${config.weightDecay}"`
      : "";
    const saveEveryNSteps = Math.max(100, Math.round(config.steps / 20));
    const trainScript = config.sdxl ? "sdxl_train_network.py" : "train_network.py";
    const noiseOffsetFlag = (config.sdxl || config.noiseOffset <= 0) ? "" : `--noise_offset ${config.noiseOffset}`;
    const minSnrFlag = config.minSnrGamma > 0 ? `--min_snr_gamma ${config.minSnrGamma}` : "";
    const vPredFlag = config.vPrediction ? "--v_parameterization --zero_terminal_snr" : "";
    const noHalfVaeFlag = config.sdxl ? "--no_half_vae" : "";
    return [
      `accelerate launch --num_cpu_threads_per_process 1 ${trainScript}`,
      `--dataset_config /workspace/kohya_config.toml`,
      `--pretrained_model_name_or_path /workspace/models/${previewModelBaseName}`,
      `--output_dir /workspace/output`,
      `--output_name ${character.triggerWord || "<trigger>"}_lora`,
      `--save_model_as safetensors`,
      `--max_train_steps ${config.steps}`,
      lrFlagStr,
      `--lr_scheduler ${lrScheduler}`,
      lrWarmupFlag,
      `--optimizer_type ${config.optimizer}`,
      optimizerArgs,
      `--network_module networks.lora`,
      `--network_dim ${config.networkDim}`,
      `--network_alpha ${networkAlpha}`,
      noiseOffsetFlag,
      minSnrFlag,
      vPredFlag,
      noHalfVaeFlag,
      `--mixed_precision bf16`,
      `--save_precision fp16`,
      previewGpuFlags.gradientCheckpointing ? "--gradient_checkpointing" : "",
      previewGpuFlags.cacheLatents ? "--cache_latents" : "",
      `--save_every_n_steps ${saveEveryNSteps}`,
    ].filter(s => s.trim()).join(" \\\n  ");
  };

  const launchTraining = async (host: string, port: number, keyPath: string, modelBaseName: string, gpuFlags: { batchSize: number; gradientCheckpointing: boolean; cacheLatents: boolean }) => {
    // Guard: refuse to launch if training is already running on the pod.
    // Check if training.log exists AND is being actively written to (modified in last 30s).
    // Avoids false positives from container startup processes matching pgrep patterns.
    try {
      const check = (await sshRunCommand(host, port, keyPath,
        "test -f /workspace/training.log && find /workspace/training.log -mmin -0.5 -print 2>/dev/null | head -1 || echo ''"
      ).catch(() => "")).trim();
      if (check) {
        log(`Training log is actively being written — not launching a duplicate.`);
        startLogPolling(host, port, keyPath, 0);
        return;
      }
    } catch { /* proceed */ }
    setUploadStatus(`Launching training…`);
    log(`Launching training…`);
    const isAdaptive = config.optimizer === "Prodigy" || config.optimizer === "DAdaptAdam";
    const networkAlpha = isAdaptive ? 1 : config.networkAlpha;
    const lrFlagStr = isAdaptive
      ? "--learning_rate 1.0"
      : `--unet_lr ${config.unetLr} --text_encoder_lr ${config.textEncoderLr}`;
    const lrScheduler = isAdaptive ? "constant" : "cosine_with_restarts";
    const lrWarmupSteps = isAdaptive ? 0 : Math.round(config.steps * 0.05);
    const lrWarmupFlag = isAdaptive ? "" : `--lr_warmup_steps ${lrWarmupSteps}`;
    const optimizerArgs = config.optimizer === "Prodigy"
      ? `--optimizer_args "decouple=True" "weight_decay=${config.weightDecay}" "d_coef=${config.prodigyDCoef}" "use_bias_correction=True" "safeguard_warmup=True"`
      : config.optimizer === "DAdaptAdam"
      ? `--optimizer_args "decouple=True" "weight_decay=${config.weightDecay}"`
      : "";
    const saveEveryNSteps = Math.max(100, Math.round(config.steps / 20));
    const trainScript = config.sdxl ? "sdxl_train_network.py" : "train_network.py";
    const gradCkptFlag = gpuFlags.gradientCheckpointing ? "--gradient_checkpointing" : "";
    const cacheLatentsFlag = gpuFlags.cacheLatents ? "--cache_latents" : "";
    // noise_offset improves contrast/saturation in SD1.x; causes color drift on SDXL (different noise schedule)
    const noiseOffsetFlag = (config.sdxl || config.noiseOffset <= 0) ? "" : `--noise_offset ${config.noiseOffset}`;
    const minSnrFlag = config.minSnrGamma > 0 ? `--min_snr_gamma ${config.minSnrGamma}` : "";
    // SDXL VAE has fp16 precision issues that cause systematic color errors baked into LoRA weights
    const noHalfVaeFlag = config.sdxl ? "--no_half_vae" : "";
    // V-prediction mode (e.g. NoobAI-XL): requires both flags together; standard SDXL uses epsilon and must NOT set these
    const vPredFlag = config.vPrediction ? "--v_parameterization --zero_terminal_snr" : "";
    const trainingArgs = [
      `accelerate launch --num_cpu_threads_per_process 1 ${trainScript}`,
      `--dataset_config /workspace/kohya_config.toml`,
      `--pretrained_model_name_or_path /workspace/models/${modelBaseName}`,
      `--output_dir /workspace/output`,
      `--output_name ${character.triggerWord}_lora`,
      `--save_model_as safetensors`,
      `--max_train_steps ${config.steps}`,
      lrFlagStr,
      `--lr_scheduler ${lrScheduler}`,
      lrWarmupFlag,
      `--optimizer_type ${config.optimizer}`,
      optimizerArgs,
      `--network_module networks.lora`,
      `--network_dim ${config.networkDim}`,
      `--network_alpha ${networkAlpha}`,
      noiseOffsetFlag,
      minSnrFlag,
      vPredFlag,
      noHalfVaeFlag,
      `--mixed_precision bf16`,
      `--save_precision fp16`,
      gradCkptFlag,
      cacheLatentsFlag,
      `--save_every_n_steps ${saveEveryNSteps}`,
    ].filter(s => s.trim()).join(" \\\n  ");
    await invoke("save_project", { path: `${character.outputDir}/training_command.txt`, data: `# Training command (debug)\n# Script: ${trainScript}\n# Generated: ${new Date().toISOString()}\n\n${trainingArgs}\n` });
    log(`[info] accelerate launch ${trainScript} --optimizer_type ${config.optimizer} --max_train_steps ${config.steps} --network_dim ${config.networkDim} --network_alpha ${networkAlpha} ${lrFlagStr}${noiseOffsetFlag ? " " + noiseOffsetFlag : " (no noise_offset — SDXL)"}${minSnrFlag ? " " + minSnrFlag : ""}`);
    await sshRunCommand(host, port, keyPath,
      `nohup bash -c '> /workspace/training.log; SCRIPT=\$(find /workspace -maxdepth 5 -name "${trainScript}" 2>/dev/null | head -1); if [ -z "\$SCRIPT" ]; then echo "ERROR: ${trainScript} not found" >> /workspace/training.log; exit 1; fi; PYTHON=""; for P in /venv/bin/python3 /venv/bin/python /opt/conda/bin/python3 /workspace/venv/bin/python3 /workspace/venv/bin/python /usr/local/bin/python3; do if [ -f "\$P" ] && "\$P" -c "import accelerate" 2>/dev/null; then PYTHON="\$P"; break; fi; done; if [ -z "\$PYTHON" ]; then echo "ERROR: no Python with accelerate found" >> /workspace/training.log; exit 1; fi; ACCEL=\$(dirname "\$PYTHON")/accelerate; mkdir -p /workspace/output; echo "launcher: \$ACCEL" >> /workspace/training.log; export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True; cd "\$(dirname "\$SCRIPT")" && "\$ACCEL" launch --num_cpu_threads_per_process 1 "\$SCRIPT" --dataset_config /workspace/kohya_config.toml --pretrained_model_name_or_path /workspace/models/${modelBaseName} --output_dir /workspace/output --output_name ${character.triggerWord}_lora --save_model_as safetensors --max_train_steps ${config.steps} ${lrFlagStr} --lr_scheduler ${lrScheduler} ${lrWarmupFlag} --optimizer_type ${config.optimizer} ${optimizerArgs} --network_module networks.lora --network_dim ${config.networkDim} --network_alpha ${networkAlpha} ${noiseOffsetFlag} ${minSnrFlag} ${vPredFlag} ${noHalfVaeFlag} --mixed_precision bf16 --save_precision fp16 ${gradCkptFlag} ${cacheLatentsFlag} --save_every_n_steps ${saveEveryNSteps} >> /workspace/training.log 2>&1; EXIT_CODE=\$?; echo "training complete" >> /workspace/training.log; if [ \$EXIT_CODE -eq 0 ]; then echo "done" > /workspace/.training_done; else echo "training failed (exit \$EXIT_CODE)" >> /workspace/training.log; fi' &`
    );
    setPipelineStep(3);
    setTrainingHalted(false);
    setUploadStatus(null);
    log(`Training started — polling /workspace/training.log for progress…`);
    log(`Note: training can take a long time depending on your dataset and GPU. You can close the app and reopen it later — it will reconnect to the running pod.`);
    startLogPolling(host, port, keyPath, 0);
  };

  const uploadToVolume = async (host: string, port: number, keyPath: string, opts: { skipZipUpload?: boolean } = {}) => {
    if (_uploadInProgress) { log("Upload already in progress — ignoring duplicate request."); return; }
    _uploadInProgress = true;
    const actualZipPath = zipPath || expectedZipPath;
    if (!actualZipPath && !opts.skipZipUpload) { _uploadInProgress = false; return; }
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
        (liveGpuTypes?.find(g => g.id === config.gpuTypeId)?.memoryInGb ?? 0);
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
      await sshUploadFile(host, port, keyPath, configPath, `/workspace/${configName}`);
      log(`Config uploaded.`);

      // Dataset upload + extraction
      let datasetExtracted = false;
      if (opts.skipZipUpload) {
        const res = await sshRunCommand(host, port, keyPath, "test -f /workspace/.extract_done && echo yes || echo no").catch(() => "no");
        if (res.trim() === "yes") {
          log("Dataset already extracted on pod — skipping upload.");
          datasetExtracted = true;
        }
      }

      if (!datasetExtracted) {
        if (!opts.skipZipUpload) {
          log(`Uploading ${zipName} to volume…`);
          const stopZipTicker = startTicker(`Uploading dataset zip…`);
          try {
            await sshUploadFile(host, port, keyPath, actualZipPath!, `/workspace/${zipName}`);
          } finally {
            stopZipTicker();
          }
          log(`Dataset uploaded.`);
        }
        setUploadStatus(`Extracting dataset on pod…`);
        log(`Extracting dataset…`);
        await sshRunCommand(host, port, keyPath, `rm -f /workspace/.extract_done; nohup bash -c 'cd /workspace && mkdir -p dataset models && unzip -o ${zipName} -d dataset && echo done > /workspace/.extract_done' &`);
        let extracted = false;
        for (let i = 0; i < 60 && !extracted; i++) {
          await new Promise(r => setTimeout(r, 5000));
          setUploadStatus(`Extracting dataset… (${(i + 1) * 5}s)`);
          const res = await sshRunCommand(host, port, keyPath, "test -f /workspace/.extract_done && echo yes || echo no").catch(() => "no");
          if (res.trim() === "yes") extracted = true;
        }
        if (!extracted) throw new Error("Dataset extraction timed out after 5 minutes");
      }

      // Handle base model checkpoint
      setPipelineStep(2);
      const modelName = (character.baseModel || "model.safetensors").replace(/\s*\[.*?\]\s*$/, "").trim();
      const modelBaseName = sanitizeShellArg(modelName.split(/[\\/]/).pop() || "model.safetensors");

      let modelOnVolume = false;
      try {
        const manifest = await sshRunCommand(host, port, keyPath, "cat /workspace/.model_manifest 2>/dev/null || echo ''");
        modelOnVolume = manifest.trim() === modelBaseName;
      } catch { /* manifest absent */ }
      if (!modelOnVolume) modelOnVolume = existing?.modelName === modelBaseName;

      if (modelOnVolume) {
        log(`Model already on volume (${modelBaseName}) — skipping download.`);
      } else if (config.baseModelDownloadUrl) {
        if (existing?.modelName && existing.modelName !== modelBaseName) {
          log(`WARNING: Replacing model on volume (${existing.modelName} → ${modelBaseName}).`);
        }
        log(`Downloading checkpoint via pod: ${config.baseModelDownloadUrl}`);
        await sshRunCommand(host, port, keyPath,
          `rm -f /workspace/.model_done; mkdir -p /workspace/models && nohup bash -c 'wget -q -O /workspace/models/${modelBaseName} "${config.baseModelDownloadUrl}" && echo "${modelBaseName}" > /workspace/.model_manifest && echo done > /workspace/.model_done' &`
        );
        let modelReady = false;
        for (let i = 0; i < 120 && !modelReady; i++) {
          await new Promise(r => setTimeout(r, 15000));
          const elapsed = `${Math.floor((i + 1) * 15 / 60)}m ${((i + 1) * 15) % 60}s`;
          setUploadStatus(`Downloading ${modelBaseName} on pod… (${elapsed})`);
          const res = await sshRunCommand(host, port, keyPath, "test -f /workspace/.model_done && echo yes || echo no").catch(() => "no");
          if (res.trim() === "yes") modelReady = true;
        }
        if (!modelReady) throw new Error(`Model download timed out after 30 minutes`);
        log(`Model downloaded.`);
      } else if (config.baseModelLocalPath) {
        if (existing?.modelName && existing.modelName !== modelBaseName) {
          log(`WARNING: Replacing model on volume (${existing.modelName} → ${modelBaseName}).`);
        }
        log(`Uploading checkpoint from local path (this may take a while)…`);
        const stopModelUploadTicker = startTicker(`Uploading ${modelBaseName}…`);
        try {
          await sshUploadFile(host, port, keyPath, config.baseModelLocalPath, `/workspace/models/${modelBaseName}`);
        } finally {
          stopModelUploadTicker();
        }
        await sshRunCommand(host, port, keyPath, `echo "${modelBaseName}" > /workspace/.model_manifest`);
        log(`Model uploaded.`);
      } else {
        log(`WARNING: No base model source set. Training will fail unless the model is already at /workspace/models/${modelBaseName}.`);
      }

      if (volumeId) {
        setSettings({ volumeContents: { ...settings.volumeContents, [volumeId]: { datasetKey, modelName: modelBaseName, uploadedAt: new Date().toISOString() } } });
      }

      await launchTraining(host, port, keyPath, modelBaseName, gpuFlags);
      _uploadInProgress = false;
    } catch (err) {
      _uploadInProgress = false;
      setUploadStatus(null);
      log(`Upload error: ${err}`);
    }
  };

  const downloadOutputs = async (host: string, port: number, keyPath: string) => {
    const char = characterRef.current;
    const destDir = char.outputDir || char.loraDir;
    if (!destDir) { log(`Cannot download: no loraDir or outputDir set on character.`); return; }

    setPipelineStep(4);
    setDownloadFailed(false);
    log(`Training complete — downloading LoRA to ${destDir}…`);
    try {
      const listing = await sshRunCommand(host, port, keyPath, "ls -1 /workspace/output/*.safetensors 2>/dev/null || echo ''");
      const files = listing.trim().split("\n").filter(f => f.trim().endsWith(".safetensors")).map(f => f.trim());

      if (files.length === 0) {
        log(`No .safetensors files found in /workspace/output/ — training may still be running or output is in a different location.`);
        setDownloadFailed(true);
        return;
      }

      const toDownload = downloadIntermediatesRef.current
        ? files
        : files.filter(f => !/-step\d+/.test(f));

      const skipped = files.length - toDownload.length;
      log(`Found ${files.length} file(s)${skipped > 0 ? `, skipping ${skipped} intermediate(s)` : ""} — downloading ${toDownload.length}…`);
      for (let i = 0; i < toDownload.length; i++) {
        const remotePath = toDownload[i];
        const filename = remotePath.split("/").pop()!;
        const localPath = `${destDir}/${filename}`;
        const fileLabel = toDownload.length > 1 ? `${filename} (${i + 1}/${toDownload.length})` : filename;
        log(`Downloading ${fileLabel}…`);
        const stopDownloadTicker = startTicker(`Downloading ${fileLabel}…`);
        try {
          await sshDownloadFile(host, port, keyPath, remotePath, localPath);
        } finally {
          stopDownloadTicker();
        }
        log(`Saved → ${localPath}`);
      }
      setUploadStatus(null);
      setPipelineStep(5);
      log(`Download complete.`);
      const podId = podRef.current?.id;
      const apiKey = apiKeyRef.current;
      if (autoTerminateRef.current && podId && apiKey) {
        try {
          await terminatePod(apiKey, podId);
          log(`Pod terminated — billing stopped.`);
        } catch (err) {
          log(`Auto-terminate failed: ${err} — use the Terminate button to stop billing.`);
        } finally {
          if (_podPollId) { clearInterval(_podPollId); _podPollId = null; }
          if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
          if (_sshWaitId) { clearInterval(_sshWaitId); _sshWaitId = null; }
          _connectedPodId = "";
          setPod(null);
          setSshInfo("", 0);
          sshHostRef.current = "";
          setRunpodActivePodId("");
          setRunpodActiveSshHost("");
          setRunpodActiveSshPort(0);
          setPhase("done");
        }
      }
    } catch (err) {
      setUploadStatus(null);
      log(`Download error: ${err}`);
      log(`Pod is still running — use Retry Download to try again.`);
      setDownloadFailed(true);
    }
  };

  const startLogPolling = (host: string, port: number, keyPath: string, fromLine: number) => {
    let seenLines = fromLine;
    let inTraceback = false;
    let detected = false;
    let tqdmMaxTotal = 0; // tracks largest tqdm total seen — used to ignore per-epoch bars

    const triggerCompletion = () => {
      if (detected) return;
      detected = true;
      if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
      setUploadStatus(null);
      downloadOutputs(host, port, keyPath);
    };

    if (_logPollId) clearInterval(_logPollId);
    _logPollId = setInterval(async () => {
      // Sentinel file check — training script writes .training_done on success
      sshRunCommand(host, port, keyPath, "test -f /workspace/.training_done && echo yes || echo no")
        .then((r) => { if (r.trim() === "yes") triggerCompletion(); })
        .catch(() => {});

      try {
        // Load only new lines since last poll (avoids 50MB+ log reads on long runs)
        const newContent = await sshRunCommand(host, port, keyPath, `awk 'NR>${seenLines}' /workspace/training.log 2>/dev/null`);
        const totalStr = await sshRunCommand(host, port, keyPath, "wc -l < /workspace/training.log 2>/dev/null || echo 0").catch(() => "0");
        seenLines = parseInt(totalStr.trim(), 10) || seenLines;
        const newLines = newContent.split("\n");

        let lastPodLine = "";
        for (const raw of newLines) {
          const line = raw.trimEnd()
            .replace(/\t\S+\.py:\d+$/, "")                                       // trailing tab+file:line
            .replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+\s+/, "")        // leading timestamp
            .replace(/^(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+\S+\.py:\d+:\s*/i, ""); // level + source ref
          if (!line) { inTraceback = false; continue; }
          // Skip tqdm progress-bar lines (contain block chars or bare percentage bars)
          // But first extract step progress to mirror into the status line
          if (/[█▏▎▍▌▋▊▉]|^\s*\d+%\s*\|/.test(line)) {
            const m = line.match(/(\d+)\/(\d+)/);
            if (m) {
              const cur = parseInt(m[1]), total = parseInt(m[2]);
              if (total > tqdmMaxTotal) tqdmMaxTotal = total;
              // Only update status for the global bar (largest total seen) — ignore per-epoch bars
              if (total === tqdmMaxTotal && total > 0 && cur <= total)
                setUploadStatus(`Training: step ${cur}/${total} (${Math.round(cur / total * 100)}%)`);
            }
            continue;
          }
          // Skip Kohya multi-process bookkeeping (logged 8× per epoch by accelerate workers)
          if (/epoch is incremented/i.test(line)) continue;

          const isError = /error|traceback|exception/i.test(line);
          const isImportant = isError || inTraceback ||
            /loss[= ]|epoch|saving|saved|step\s+\d|finished|complete|failed|cuda|oom|python:|workspace:|dataset:/i.test(line);

          if (isImportant) {
            // Deduplicate consecutive identical pod lines (reconnect double-fire)
            if (line === lastPodLine) continue;
            lastPodLine = line;
            log(`[pod] ${line}`);
            if (isError) inTraceback = true;
          }
        }

        const newContentStr = newLines.join("\n");
        // Stop polling on completion or fatal halt (check only new lines to avoid re-triggering)
        // Check failure FIRST — the training script always writes "training complete" before
        // "training failed (exit N)", so if both appear we must not treat it as success.
        if (/training failed \(exit|ModuleNotFoundError|No module named|command not found/i.test(newContentStr)) {
          if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
          if (_podPollId) { clearInterval(_podPollId); _podPollId = null; setPolling(false); }
          log(`Training halted — see errors above.`);
          log(`Pod is still running — use Retry to relaunch, or Terminate to stop billing.`);
          setTrainingHalted(true);
        } else if (/training (finished|complete|done)|^training complete$/im.test(newContentStr)) {
          triggerCompletion();
        }
      } catch { /* file not yet available */ }
    }, 5000);
  };

  const startPolling = (podId: string) => {
    if (!podId) return;
    if (_podPollId) { clearInterval(_podPollId); _podPollId = null; }
    setPolling(true);
    let consecutiveErrors = 0;
    let cancelled = false;
    const stopPodTicker = startTicker("Waiting for pod to start…");
    const stopPolling = (reason: string) => {
      cancelled = true;
      stopPodTicker();
      log(reason);
      if (_podPollId) { clearInterval(_podPollId); _podPollId = null; }
      setPolling(false);
      setPod(null);
      sshHostRef.current = "";
      setSshInfo("", 0);
      if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
      if (_sshWaitId) { clearInterval(_sshWaitId); _sshWaitId = null; }
      setUploadStatus(null);
      setPhase("done");
      setRunpodActivePodId("");
      setRunpodActiveSshHost("");
      setRunpodActiveSshPort(0);
    };
    const tick = async () => {
      if (cancelled) return;
      try {
        const updated = await getPod(apiKeyRef.current, podId);
        consecutiveErrors = 0;
        setPod(updated);
        const terminal = updated.status === "EXITED" || updated.status === "TERMINATED" || updated.status === "DEAD";
        if (terminal) {
          stopPolling(`Pod ${updated.status.toLowerCase()} — terminated externally.`);
        } else if (updated.status === "RUNNING") {
          const uptime = updated.runtime?.uptimeInSeconds ?? 0;
          stopPodTicker();
          // Only fetch SSH info once (sshHostRef guards against repeated calls)
          if (!sshHostRef.current) {
            try {
              // Try pod runtime ports first (reliable), fall back to runpodctl ssh info
              const info = await getSshInfo(apiKeyRef.current, updated.id);
              if (info) {
                setSshInfo(info.host, info.port);
                sshHostRef.current = info.host;
                const uptimeStr = uptime > 0 ? ` (uptime: ${uptime}s)` : "";
                log(`Pod running${uptimeStr} — waiting for SSH on ${info.host}:${info.port}…`);
                startSshWait(info.host, info.port, settings.sshKeyPath, { checkFirst: linkedPodRef.current });
              } else {
                log(`SSH info not available yet for pod ${updated.id} — retrying next tick…`);
              }
            } catch (sshErr) {
              log(`SSH info fetch failed: ${sshErr} — retrying next tick`);
            }
          }
        }
      } catch (err) {
        const msg = String(err).toLowerCase();
        if (msg.includes("not found") || msg.includes("does not exist") || msg.includes("no pod")) {
          stopPolling("Pod no longer found on RunPod — may have been deleted externally.");
        } else {
          consecutiveErrors++;
          if (consecutiveErrors >= 20) {
            if (sshHostRef.current) {
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
    if (!pod || terminating) return;
    setTerminating(true);
    try {
      await terminatePod(settings.runpodApiKey, pod.id);
      log(`Pod ${pod.id} terminated.`);
    } catch (err) {
      log(`Terminate error: ${err}`);
    } finally {
      setTerminating(false);
      // Stop all polling and clear persisted pod state
      if (_podPollId) { clearInterval(_podPollId); _podPollId = null; }
      if (_logPollId) { clearInterval(_logPollId); _logPollId = null; }
      if (_sshWaitId) { clearInterval(_sshWaitId); _sshWaitId = null; }
      _connectedPodId = "";
      setPod(null);
      setSshInfo("", 0);
      sshHostRef.current = "";
      setRunpodActivePodId("");
      setRunpodActiveSshHost("");
      setRunpodActiveSshPort(0);
      setPhase("done");
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
    linkedPodRef.current = true;
    log(`Linked to existing pod: ${p.id} — fetching SSH info…`);
    // SSH info will be fetched in startPolling's RUNNING tick
    startPolling(p.id);
  };

  const fetchPrices = async () => {
    if (!hasApiKey) { log("Add your RunPod API key in Settings first."); return; }
    setFetchingPrices(true);
    try {
      const [gpus, prices] = await Promise.allSettled([
        listGpuTypes(settings.runpodApiKey),
        fetchGpuPrices(settings.runpodApiKey),
      ]);
      if (gpus.status === "fulfilled") {
        setLiveGpuTypes([...gpus.value].sort((a, b) => b.memoryInGb - a.memoryInGb));
      } else {
        log(`GPU list fetch error: ${gpus.reason}`);
      }
      if (prices.status === "fulfilled") {
        setLivePrices(prices.value);
      }
      // Pricing failure is silent — GPU list still shows without prices
    } catch (err) {
      log(`GPU list fetch error: ${err}`);
    }
    setFetchingPrices(false);
  };

  // Re-fetch GPU list when API key is available
  useEffect(() => {
    if (hasApiKey) fetchPrices();
  }, [hasApiKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {/* Setup panel */}
          <div style={{ marginBottom: "20px", padding: "12px", background: "var(--accent-glow)", border: "1px solid var(--accent-dim)", borderRadius: "6px" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "12px", fontWeight: 700, color: "var(--accent-bright)", letterSpacing: "0.05em", marginBottom: "10px", textTransform: "uppercase" }}>
                Setup
              </div>
              {/* Step 1: runpodctl */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: runpodctlStatus === "ready" ? "var(--green)" : "var(--accent-bright)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-primary)", flex: 1 }}>
                  runpodctl CLI
                </span>
                {runpodctlStatus === "missing" && (
                  <button
                    className="btn-ghost"
                    style={{ padding: "2px 8px", fontSize: "10px" }}
                    onClick={async () => {
                      setRunpodctlStatus("installing");
                      try {
                        await installRunpodctl();
                        setRunpodctlStatus("ready");
                        log("runpodctl installed.");
                      } catch (err) {
                        log(`Install failed: ${err}`);
                        setRunpodctlStatus("missing");
                      }
                    }}
                  >Install</button>
                )}
                {runpodctlStatus === "installing" && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)" }}>Installing…</span>
                )}
                {runpodctlStatus === "ready" && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--green)" }}>✓</span>
                )}
                {runpodctlStatus === "checking" && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)" }}>Checking…</span>
                )}
              </div>
              {/* Step 2: SSH key */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: runpodctlStatus !== "ready" ? 0.4 : 1 }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: settings.sshKeyPath ? "var(--green)" : "var(--accent-bright)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-primary)", flex: 1 }}>
                  SSH key registered with RunPod
                </span>
                {runpodctlStatus === "ready" && (
                  <button
                    className="btn-ghost"
                    style={{ padding: "2px 8px", fontSize: "10px", color: sshKeyState === "done" ? "var(--green)" : sshKeyState === "error" ? "var(--red-bright)" : undefined, borderColor: sshKeyState === "done" ? "var(--green)" : sshKeyState === "error" ? "var(--red)" : undefined }}
                    disabled={!hasApiKey || sshKeyState === "working"}
                    title={!hasApiKey ? "Add RunPod API key in Settings first" : ""}
                    onClick={async () => {
                      setSshKeyState("working");
                      try {
                        const keyPath = await setupSshKey(settings.runpodApiKey);
                        setSettings({ sshKeyPath: keyPath });
                        log(`SSH key registered: ${keyPath}`);
                        setSshKeyState("done");
                        setTimeout(() => setSshKeyState("idle"), 2000);
                      } catch (err) {
                        log(`SSH key setup failed: ${err}`);
                        setSshKeyState("error");
                        setTimeout(() => setSshKeyState("idle"), 3000);
                      }
                    }}
                  >
                    {sshKeyState === "working" ? "Registering…" : sshKeyState === "done" ? "✓ Registered" : sshKeyState === "error" ? "Failed" : settings.sshKeyPath ? "Re-register" : "Setup"}
                  </button>
                )}
              </div>
          </div>

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
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)" }}>{label}</span>
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
                  color: "var(--red-bright)",
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
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)" }}>Add RunPod API key in Settings.</div>
            ) : networkVolumes.length === 0 ? (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)" }}>
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
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: selected ? "var(--accent-bright)" : "var(--text-secondary)" }}>{v.size}GB · {v.dataCenterId}</div>
                    </div>
                    {contents && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: selected ? "var(--accent-bright)" : "var(--text-secondary)", marginTop: "3px", opacity: 0.8 }}>
                        Last upload: {contents.datasetKey} · {new Date(contents.uploadedAt).toLocaleDateString()}
                      </div>
                    )}
                    {selected && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", marginTop: "3px", opacity: 0.7 }}>
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
              <button className="btn-ghost" onClick={fetchPrices} disabled={fetchingPrices} style={{ padding: "2px 8px", fontSize: "10px" }}>
                <RefreshCw size={10} style={{ display: "inline", marginRight: "4px" }} />
                {fetchingPrices ? "Fetching…" : "Refresh GPUs"}
              </button>
            </div>
            {(() => {
              const gpuList = liveGpuTypes ?? RECOMMENDED_GPUS.map((g) => ({ id: g.id, displayName: g.label, memoryInGb: g.vram }));
              // Compute best value: steps/sec per $/hr — only for GPUs in RECOMMENDED_GPUS (have throughput data)
              let bestValueGpuId: string | null = null;
              if (livePrices) {
                let bestRatio = 0;
                for (const gpu of gpuList) {
                  const rec = RECOMMENDED_GPUS.find(r => r.id === gpu.id || r.label === gpu.displayName);
                  if (!rec) continue;
                  const price = livePrices.get(gpu.displayName);
                  const pricePerHr = config.cloudType === "SECURE"
                    ? (price?.secure ?? 0)
                    : (price?.community ?? price?.secure ?? 0);
                  if (pricePerHr <= 0) continue;
                  const ratio = rec.stepsPerSec / pricePerHr;
                  if (ratio > bestRatio) { bestRatio = ratio; bestValueGpuId = gpu.id; }
                }
              }
              return gpuList.map((gpu, idx) => {
              const selected = config.gpuTypeId === gpu.id;
              const price = livePrices?.get(gpu.displayName);
              const securePrice = price?.secure ?? 0;
              const communityPrice = price?.community ?? 0;
              const showPrice = securePrice > 0 || communityPrice > 0;
              const isBestValue = bestValueGpuId !== null && gpu.id === bestValueGpuId;
              return (
                <div
                  key={gpu.id || idx}
                  onClick={() => setConfig({ gpuTypeId: gpu.id })}
                  style={{
                    padding: "8px 10px",
                    marginTop: "4px",
                    borderRadius: "5px",
                    cursor: "pointer",
                    background: selected ? "var(--accent-glow)" : "var(--bg-2)",
                    border: `1px solid ${selected ? "var(--accent-dim)" : "var(--border)"}`,
                    transition: "all 0.1s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: selected ? "var(--accent-bright)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {gpu.displayName}
                      </div>
                      {isBestValue && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.06em", color: "var(--green)", background: "var(--green-dim)", border: "1px solid var(--green)", borderRadius: "3px", padding: "1px 5px", flexShrink: 0 }}>
                          BEST VALUE
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: selected ? "var(--accent-bright)" : "var(--text-secondary)", flexShrink: 0 }}>
                      {gpu.memoryInGb}GB
                    </div>
                  </div>
                  {showPrice && (
                    <div style={{ display: "flex", gap: "10px", marginTop: "3px" }}>
                      {securePrice > 0 && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: selected ? "var(--accent-bright)" : "var(--text-secondary)" }}>
                          secure ${securePrice.toFixed(3)}/hr
                        </span>
                      )}
                      {communityPrice > 0 && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: selected ? "var(--accent-bright)" : "var(--text-secondary)" }}>
                          community ${communityPrice.toFixed(3)}/hr
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
              });
            })()}
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
            <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
              ALL = cheapest available (community first). SECURE = guaranteed. COMMUNITY = spot only.
            </div>
          </div>

          {/* Training hyperparams */}
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div className="section-label" style={{ margin: 0 }}>Training Hyperparameters</div>
                {settings.ezMode && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "8px", letterSpacing: "0.08em", color: "var(--accent-bright)", background: "var(--accent-glow)", border: "1px solid var(--accent-dim)", borderRadius: "3px", padding: "1px 5px" }}>EZ</span>
                )}
              </div>
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <button
                  onClick={applySensibleDefaults}
                  style={{
                    padding: "2px 8px", fontSize: "9px", cursor: "pointer",
                    background: "var(--bg-2)", border: "1px solid var(--border)",
                    color: "var(--text-muted)", borderRadius: "4px",
                    fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
                  }}
                  title="Auto-populate with recommended settings for this model type and dataset size"
                >↺ defaults</button>
                {(["SDXL", "SD 1.5"] as const).map((label) => {
                  const isXL = label === "SDXL";
                  const active = config.sdxl === isXL;
                  return (
                    <button
                      key={label}
                      onClick={() => !settings.ezMode && setConfig({ sdxl: isXL })}
                      disabled={settings.ezMode}
                      title={settings.ezMode ? "Disable EZ Mode to edit" : undefined}
                      style={{
                        padding: "2px 8px", fontSize: "10px", cursor: settings.ezMode ? "default" : "pointer",
                        background: active ? "var(--bg-4)" : "var(--bg-2)",
                        border: `1px solid ${active ? "var(--accent-dim)" : "var(--border)"}`,
                        color: active ? "var(--accent-bright)" : "var(--text-muted)",
                        borderRadius: "4px", opacity: settings.ezMode ? 0.5 : 1,
                        fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.06em",
                      }}
                    >{label}</button>
                  );
                })}
              </div>
            </div>
            {/* V-Prediction toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: "11px", color: config.vPrediction ? "var(--text)" : "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={config.vPrediction}
                  onChange={(e) => setConfig({ vPrediction: e.target.checked })}
                  style={{ accentColor: "var(--accent)" }}
                />
                V-Prediction mode
              </label>
              {config.vPrediction && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--accent-dim)" }}>
                  --v_parameterization --zero_terminal_snr
                </span>
              )}
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: "11px", color: "var(--text-secondary)", marginTop: "3px", marginBottom: "4px" }}>
              Enable for NoobAI-XL and other v-pred models. Standard SDXL uses epsilon — leave off.
            </div>
            {/* Optimizer selector */}
            <div style={{ display: "flex", gap: "4px", marginTop: "6px", marginBottom: "8px" }}>
              {(["AdamW8bit", "Prodigy", "DAdaptAdam"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => !settings.ezMode && setConfig({ optimizer: opt })}
                  disabled={settings.ezMode}
                  title={settings.ezMode ? "Disable EZ Mode to edit" : undefined}
                  style={{
                    flex: 1, padding: "4px 6px", fontSize: "10px", cursor: settings.ezMode ? "default" : "pointer",
                    background: config.optimizer === opt ? "var(--bg-4)" : "var(--bg-2)",
                    border: `1px solid ${config.optimizer === opt ? "var(--accent-dim)" : "var(--border)"}`,
                    color: config.optimizer === opt ? "var(--accent-bright)" : "var(--text-muted)",
                    borderRadius: "4px", opacity: settings.ezMode ? 0.5 : 1,
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
            {(config.optimizer === "Prodigy" || config.optimizer === "DAdaptAdam") && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "6px" }}>
                {config.optimizer === "Prodigy" && (
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", marginBottom: "3px", letterSpacing: "0.06em", textTransform: "uppercase" }}>D Coef</div>
                    <input
                      type="number"
                      step="0.1"
                      style={{ width: "100%", opacity: settings.ezMode ? 0.4 : 1 }}
                      value={config.prodigyDCoef}
                      onChange={(e) => setConfig({ prodigyDCoef: parseFloat(e.target.value) || 1 })}
                      disabled={settings.ezMode}
                      title={settings.ezMode ? "Disable EZ Mode to edit" : undefined}
                    />
                    <div style={{ fontFamily: "var(--font-body)", fontSize: "10px", color: "var(--text-secondary)", marginTop: "2px" }}>LR scale (0.5 = slow, 2 = fast)</div>
                  </div>
                )}
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", marginBottom: "3px", letterSpacing: "0.06em", textTransform: "uppercase" }}>Weight Decay</div>
                  <input
                    type="number"
                    step="0.001"
                    style={{ width: "100%", opacity: settings.ezMode ? 0.4 : 1 }}
                    value={config.weightDecay}
                    onChange={(e) => setConfig({ weightDecay: parseFloat(e.target.value) || 0 })}
                    disabled={settings.ezMode}
                    title={settings.ezMode ? "Disable EZ Mode to edit" : undefined}
                  />
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "6px" }}>
              {[
                { label: "Steps", key: "steps" as const, type: "number" },
                { label: "UNet LR", key: "unetLr" as const, type: "text" },
                { label: "Text Encoder LR", key: "textEncoderLr" as const, type: "text" },
                { label: "Network Dim", key: "networkDim" as const, type: "number" },
                { label: "Network Alpha", key: "networkAlpha" as const, type: "number" },
                { label: "Resolution", key: "resolution" as const, type: "number" },
                { label: "Noise Offset", key: "noiseOffset" as const, type: "number" },
                { label: "Min SNR Gamma", key: "minSnrGamma" as const, type: "number" },
                { label: "Container Disk (GB)", key: "containerDiskInGb" as const, type: "number" },
              ].map(({ label, key, type }) => {
                const isLrKey = key === "unetLr" || key === "textEncoderLr";
                const isAlphaKey = key === "networkAlpha";
                const disabledByAdaptive = (isLrKey || isAlphaKey) && (config.optimizer === "Prodigy" || config.optimizer === "DAdaptAdam");
                const isDisabled = disabledByAdaptive || settings.ezMode;
                const suggestedSteps = approved.length > 0
                  ? config.sdxl
                    ? Math.max(1500, Math.min(3000, Math.round(approved.length * 60 / 100) * 100))
                    : Math.max(1000, Math.min(2000, Math.round(approved.length * 40 / 100) * 100))
                  : null;
                return (
                  <div key={key}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", marginBottom: "3px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                    <input
                      type={type}
                      step={key === "noiseOffset" ? "0.001" : undefined}
                      style={{ width: "100%", opacity: isDisabled ? 0.4 : 1 }}
                      value={config[key]}
                      onChange={(e) => {
                        const val = type === "number"
                          ? (key === "noiseOffset" ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0)
                          : e.target.value;
                        setConfig({ [key]: val });
                      }}
                      disabled={isDisabled}
                      title={settings.ezMode ? "Disable EZ Mode to edit" : disabledByAdaptive ? "Managed by adaptive optimizer" : undefined}
                    />
                    {key === "steps" && suggestedSteps && config.steps !== suggestedSteps && !settings.ezMode && (
                      <div
                        onClick={() => setConfig({ steps: suggestedSteps })}
                        style={{ marginTop: "3px", fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--accent-dim)", cursor: "pointer", letterSpacing: "0.04em" }}
                        title={`${approved.length} images × ${config.sdxl ? 60 : 40} steps`}
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
              Recommended for Illustrious: dim=32, alpha=16, unet_lr=5e-5, te_lr=1e-5, 1500–2500 steps. For SDXL character LoRAs, dim=32 is preferred — higher rank absorbs style and colour from training data. Noise offset and min SNR gamma are ignored for SDXL.
            </div>
            <div style={{ marginTop: "8px" }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildTrainingCommand());
                  setCommandCopied(true);
                  setTimeout(() => setCommandCopied(false), 2000);
                }}
                style={{
                  padding: "3px 10px", fontSize: "10px", cursor: "pointer",
                  background: "var(--bg-2)", border: "1px solid var(--border)",
                  color: commandCopied ? "var(--accent-bright)" : "var(--text-muted)",
                  borderRadius: "4px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
                }}
              >
                {commandCopied ? "✓ copied" : "copy training command"}
              </button>
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
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "0.04em" }}>auto-download on complete</span>
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
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", marginBottom: "4px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
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
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", marginTop: "2px" }}>{result.sublabel}</div>
                    </div>
                  ))}
                </div>
              )}
              {modelOpen && modelResults.length === 0 && (
                <div style={{ marginTop: "4px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)", padding: "6px 0" }}>No results.</div>
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
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-secondary)", marginBottom: "3px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
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
              color: "var(--red-bright)",
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
                  background: pod.status === "RUNNING" && sshHost ? "var(--green)" : pod.status === "EXITED" ? "var(--red)" : "var(--accent)",
                  flexShrink: 0,
                  ...(pod.status === "RUNNING" ? { animation: "pulse 2s infinite" } : {}),
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                    Pod {pod.id.slice(0, 8)}… — <span style={{ color: pod.status === "RUNNING" ? "var(--green)" : "var(--text-secondary)" }}>
                      {pod.status === "RUNNING" && !sshHost ? "LAUNCHING" : pod.status}
                    </span>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)" }}>
                    ${pod.costPerHr?.toFixed(3) ?? "?"}/hr
                    {podUptimeSec != null && podUptimeSec > 0
                      ? ` · ${podUptimeSec >= 3600 ? `${Math.floor(podUptimeSec / 3600)}h ${Math.floor((podUptimeSec % 3600) / 60)}m` : `${Math.floor(podUptimeSec / 60)}m ${podUptimeSec % 60}s`}`
                      : ""}
                    {podUptimeSec != null && podUptimeSec > 0 && pod.costPerHr
                      ? ` · ~$${(pod.costPerHr * podUptimeSec / 3600).toFixed(3)} spent`
                      : ""}
                    {polling ? " · polling every 15s" : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  {sshHost && sshPort && (
                    <div
                      style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", cursor: "pointer", padding: "5px 8px", borderRadius: "4px", background: "var(--bg-3)", border: "1px solid var(--border)" }}
                      onClick={() => navigator.clipboard.writeText(`ssh -p ${sshPort} root@${sshHost}`)}
                      title="Click to copy SSH command"
                    >
                      ssh root@{sshHost} -p {sshPort}
                    </div>
                  )}
                  <button
                    onClick={terminateCurrentPod}
                    disabled={terminating}
                    style={{ padding: "5px 12px", fontSize: "11px", display: "flex", alignItems: "center", gap: "5px", background: "var(--red-dim)", border: "1px solid var(--red)", color: "var(--red-bright)", borderRadius: "4px", cursor: terminating ? "default" : "pointer", opacity: terminating ? 0.5 : 1, fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em" }}
                  >
                    <Square size={11} />
                    {terminating ? "Terminating…" : "Terminate"}
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
            {uploadStatus && (
              <div style={{ color: "var(--accent-bright)", display: "flex", alignItems: "center", gap: "8px", padding: "4px 20px 4px", flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
                <RefreshCw size={10} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                {uploadStatus}
              </div>
            )}
            {settings.ezMode ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 40px", gap: "16px" }}>
                {(() => {
                  const m = uploadStatus?.match(/step (\d+)\/(\d+)/);
                  if (m) {
                    const cur = parseInt(m[1]), total = parseInt(m[2]);
                    const pct = Math.round(cur / total * 100);
                    return (
                      <>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "32px", fontWeight: 700, color: "var(--accent-bright)", letterSpacing: "-0.02em" }}>
                          {cur} <span style={{ fontSize: "18px", color: "var(--text-secondary)", fontWeight: 400 }}>/ {total}</span>
                        </div>
                        <div style={{ width: "100%", maxWidth: "360px", height: "6px", background: "var(--bg-3)", borderRadius: "3px", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width 3s ease", borderRadius: "3px" }} />
                        </div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text-secondary)" }}>{pct}%</div>
                      </>
                    );
                  }
                  const lastLine = [...logs].reverse().find(l => l.trim());
                  const isTraining = pipelineStep === 3 && !trainingHalted && !downloadFailed;
                  return (
                    <>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
                        {lastLine ?? (uploadStatus ?? "Ready. Package your dataset to begin.")}
                      </div>
                      {isTraining && (
                        <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-secondary)", textAlign: "center", fontStyle: "italic", opacity: 0.7 }}>
                          🧻 Don't Panic — it's supposed to be slow
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
            <div ref={logScrollRef} style={{ flex: 1, overflow: "auto", padding: "0 20px 16px" }}>
              {logs.length === 0 && !uploadStatus && (
                <div style={{ color: "var(--text-secondary)" }}>
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
              {pipelineStep === 3 && sshHost && !downloadFailed && !trainingHalted && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px", marginTop: "8px",
                  padding: "7px 10px", borderRadius: "5px",
                  position: "sticky", bottom: 0,
                  background: "rgba(100,100,100,0.15)", border: "1px solid rgba(150,150,150,0.25)",
                  backdropFilter: "blur(4px)",
                }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-dim)", flex: 1 }}>
                    Training complete? Force-start download
                  </span>
                  <button
                    className="btn-ghost"
                    disabled={!!uploadStatus}
                    style={{ padding: "3px 10px", fontSize: "10px", color: "var(--accent-bright)", borderColor: "var(--accent-dim)" }}
                    onClick={() => downloadOutputs(sshHost, sshPort, settings.sshKeyPath)}
                  >
                    Download LoRA
                  </button>
                </div>
              )}
              {downloadFailed && sshHost && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px", marginTop: "8px",
                  padding: "7px 10px", borderRadius: "5px",
                  position: "sticky", bottom: 0,
                  background: "rgba(212,112,112,0.12)", border: "1px solid rgba(212,112,112,0.3)",
                  backdropFilter: "blur(4px)",
                }}>
                  <AlertTriangle size={12} style={{ color: "var(--red-bright)", flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--red-bright)", flex: 1 }}>
                    Download failed — training output still on pod
                  </span>
                  <button
                    className="btn-ghost"
                    disabled={!!uploadStatus}
                    style={{ padding: "3px 10px", fontSize: "10px", color: "var(--accent-bright)", borderColor: "var(--accent-dim)" }}
                    onClick={() => downloadOutputs(sshHost, sshPort, settings.sshKeyPath)}
                  >
                    Retry Download
                  </button>
                </div>
              )}
              {trainingHalted && sshHost && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px", marginTop: "8px",
                  padding: "7px 10px", borderRadius: "5px",
                  position: "sticky", bottom: 0,
                  background: "rgba(212,112,112,0.12)", border: "1px solid rgba(212,112,112,0.3)",
                  backdropFilter: "blur(4px)",
                }}>
                  <AlertTriangle size={12} style={{ color: "var(--red-bright)", flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--red-bright)", flex: 1 }}>
                    Training halted
                  </span>
                  <button
                    className="btn-ghost"
                    style={{ padding: "3px 10px", fontSize: "10px", color: "var(--accent-bright)", borderColor: "var(--accent-dim)" }}
                    onClick={() => { setTrainingHalted(false); checkAndResume(sshHost, sshPort, settings.sshKeyPath); startPolling(pod?.id ?? ""); }}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
            )}
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
