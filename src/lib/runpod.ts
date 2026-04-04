// RunPod management via runpodctl CLI + SSH

import { invoke } from "@tauri-apps/api/core";

export interface NetworkVolume {
  id: string;
  name: string;
  size: number;
  dataCenterId: string;
}

export interface PodSpec {
  name: string;
  imageName: string;
  gpuTypeId: string;
  cloudType: "SECURE" | "COMMUNITY" | "ALL";
  containerDiskInGb: number;
  volumeInGb: number;
  volumeMountPath?: string;
  env: Array<{ key: string; value: string }>;
  ports?: string;
  networkVolumeId?: string;
  dataCenterId?: string;
}

export interface Pod {
  id: string;
  name: string;
  status: string;
  runtime?: {
    uptimeInSeconds: number;
    ports?: Array<{ ip: string; isIpPublic: boolean; privatePort: number; publicPort: number; type: string }>;
  };
  costPerHr?: number;
}

export interface SshInfo {
  host: string;
  port: number;
}

// ── GraphQL pricing (fetch() is fine — external URL) ──────────────────────────

export interface GpuPrice {
  secure: number;   // uninterruptablePrice
  community: number; // minimumBidPrice
}

// Returns a map of displayName → prices. Missing entries = no pricing data available.
export async function fetchGpuPrices(apiKey: string): Promise<Map<string, GpuPrice>> {
  const json = await invoke<any>("fetch_gpu_prices", { apiKey });
  const types: any[] = json?.data?.gpuTypes ?? [];
  const map = new Map<string, GpuPrice>();
  for (const g of types) {
    if (g.displayName && g.lowestPrice) {
      map.set(g.displayName, {
        secure: g.lowestPrice.uninterruptablePrice ?? 0,
        community: g.lowestPrice.minimumBidPrice ?? 0,
      });
    }
  }
  return map;
}

// ── runpodctl helpers ──────────────────────────────────────────────────────────

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runpodctl(args: string[], apiKey: string): Promise<string> {
  return invoke<string>("run_runpodctl", { args, apiKey });
}

export async function checkRunpodctl(): Promise<boolean> {
  return invoke<boolean>("check_runpodctl");
}

export async function installRunpodctl(): Promise<string> {
  return invoke<string>("install_runpodctl");
}

export async function setupSshKey(apiKey: string): Promise<string> {
  return invoke<string>("setup_ssh_key", { apiKey });
}

// ── Pod management ─────────────────────────────────────────────────────────────

export async function listNetworkVolumes(apiKey: string): Promise<NetworkVolume[]> {
  const out = await runpodctl(["network-volume", "list"], apiKey);
  const parsed = tryParseJson(out.trim());
  if (!parsed || !Array.isArray(parsed)) return [];
  return parsed.map((v: any) => ({
    id: v.id ?? v.Id ?? "",
    name: v.name ?? v.Name ?? "",
    size: v.size ?? v.Size ?? 0,
    dataCenterId: v.dataCenterId ?? v.DataCenterId ?? v.dataCenter ?? "",
  }));
}

export async function listGpuTypes(apiKey: string): Promise<Array<{ id: string; displayName: string; memoryInGb: number }>> {
  // Note: runpodctl gpu list does not return pricing data.
  // GPU IDs from this list may differ in format from RECOMMENDED_GPUS — verify with `runpodctl gpu list`.
  const out = await runpodctl(["gpu", "list"], apiKey);
  const parsed = tryParseJson(out.trim());
  if (!parsed || !Array.isArray(parsed)) return [];
  return parsed.map((g: any) => ({
    id: g.gpuId ?? g.id ?? g.Id ?? "",
    displayName: g.displayName ?? g.name ?? g.Name ?? g.gpuId ?? "",
    memoryInGb: g.memoryInGb ?? g.memGb ?? g.vram ?? 0,
  }));
}

export async function createPod(apiKey: string, spec: PodSpec): Promise<Pod> {
  const args = [
    "pod", "create",
    "--image", spec.imageName,
    "--name", spec.name,
    "--gpu-id", spec.gpuTypeId,
    "--gpu-count", "1",
    "--cloud-type", spec.cloudType,
    "--container-disk-in-gb", String(spec.containerDiskInGb),
    "--volume-in-gb", String(spec.volumeInGb),
    "--volume-mount-path", spec.volumeMountPath ?? "/workspace",
    "--ports", spec.ports ?? "22/tcp",
    ...spec.env.flatMap(e => ["--env", `${e.key}=${e.value}`]),
    ...(spec.networkVolumeId ? ["--network-volume-id", spec.networkVolumeId] : []),
    ...(spec.dataCenterId ? ["--data-center-ids", spec.dataCenterId] : []),
  ];
  const out = await runpodctl(args, apiKey);
  const parsed = tryParseJson(out.trim()) as any;
  if (!parsed) throw new Error(`Failed to parse pod create response: ${out}`);
  return {
    id: parsed.id ?? parsed.Id ?? "",
    name: parsed.name ?? parsed.Name ?? spec.name,
    status: parsed.desiredStatus ?? parsed.status ?? parsed.Status ?? "PENDING",
    costPerHr: parsed.costPerHr ?? parsed.CostPerHr,
  };
}

export async function getPod(apiKey: string, podId: string): Promise<Pod> {
  const out = await runpodctl(["pod", "get", podId], apiKey);
  const parsed = tryParseJson(out.trim()) as any;
  if (!parsed) throw new Error(`Failed to parse pod get response: ${out}`);
  return {
    id: parsed.id ?? parsed.Id ?? podId,
    name: parsed.name ?? parsed.Name ?? "",
    status: parsed.desiredStatus ?? parsed.status ?? parsed.Status ?? "UNKNOWN",
    costPerHr: parsed.costPerHr ?? parsed.CostPerHr,
    runtime: parsed.runtime ?? (parsed.uptimeSeconds != null ? { uptimeInSeconds: parsed.uptimeSeconds } : undefined),
  };
}

export async function terminatePod(apiKey: string, podId: string): Promise<void> {
  await runpodctl(["pod", "remove", podId], apiKey);
}

export async function listPods(apiKey: string): Promise<Pod[]> {
  const out = await runpodctl(["pod", "list"], apiKey);
  const parsed = tryParseJson(out.trim());
  if (!parsed || !Array.isArray(parsed)) return [];
  return parsed.map((p: any) => ({
    id: p.id ?? p.Id ?? "",
    name: p.name ?? p.Name ?? "",
    status: p.desiredStatus ?? p.status ?? p.Status ?? "UNKNOWN",
    costPerHr: p.costPerHr ?? p.CostPerHr,
    runtime: p.runtime ?? (p.uptimeSeconds != null ? { uptimeInSeconds: p.uptimeSeconds } : undefined),
  }));
}

// Fetch SSH connection info via RunPod GraphQL API (bypasses unreliable `runpodctl ssh info`).
// Returns null if runtime ports aren't available yet.
export async function getSshInfo(apiKey: string, podId: string): Promise<SshInfo | null> {
  const res = await invoke<any>("fetch_pod_ssh", { apiKey, podId });
  const ports = res?.data?.pod?.runtime?.ports as Array<{ ip: string; privatePort: number; publicPort: number }> | undefined;
  if (!ports || ports.length === 0) return null;
  const sshPort = ports.find(p => p.privatePort === 22);
  if (!sshPort || !sshPort.ip || !sshPort.publicPort) return null;
  return { host: sshPort.ip, port: sshPort.publicPort };
}

// ── SSH invoke wrappers ────────────────────────────────────────────────────────

export function sshIsReady(host: string, port: number, keyPath: string): Promise<boolean> {
  return invoke<boolean>("ssh_is_ready", { host, port, keyPath });
}

export function sshRunCommand(host: string, port: number, keyPath: string, command: string): Promise<string> {
  return invoke<string>("run_ssh_command", { host, port, keyPath, command });
}

export function sshUploadFile(host: string, port: number, keyPath: string, localPath: string, remotePath: string): Promise<void> {
  return invoke("ssh_upload_file", { host, port, keyPath, localPath, remotePath });
}

export function sshDownloadFile(host: string, port: number, keyPath: string, remotePath: string, localPath: string): Promise<void> {
  return invoke("ssh_download_file", { host, port, keyPath, remotePath, localPath });
}

// ── GPU recommendations ────────────────────────────────────────────────────────

// stepsPerSec: real-world throughput at 1024px SDXL (L40S confirmed at 0.4; others scaled proportionally)
// Note: GPU IDs must match exactly what `runpodctl gpu list` returns — verify after install.
export const RECOMMENDED_GPUS = [
  { id: "NVIDIA A100 80GB PCIe",    label: "A100 80GB",      vram: 80, stepsPerSec: 0.70 },
  { id: "NVIDIA A100-SXM4-40GB",   label: "A100 40GB",      vram: 40, stepsPerSec: 0.55 },
  { id: "NVIDIA RTX A6000",         label: "RTX A6000 48GB", vram: 48, stepsPerSec: 0.40 },
  { id: "NVIDIA L40S",              label: "L40S 48GB",       vram: 48, stepsPerSec: 0.40 },
  { id: "NVIDIA GeForce RTX 3090",  label: "RTX 3090 24GB",  vram: 24, stepsPerSec: 0.20 },
];

export interface GpuTrainingFlags {
  batchSize: number;
  gradientCheckpointing: boolean;
  cacheLatents: boolean;
}

// Returns optimal training flags for the available VRAM.
// Adaptive optimizers (Prodigy, DAdaptAdam) use more VRAM — reduce batch size one tier.
export function gpuTrainingFlags(vramGb: number, optimizer?: string): GpuTrainingFlags {
  const adaptive = optimizer === "Prodigy" || optimizer === "DAdaptAdam";
  if (vramGb >= 80) return { batchSize: adaptive ? 1 : 2, gradientCheckpointing: false, cacheLatents: true };
  if (vramGb >= 48) return { batchSize: adaptive ? 1 : 2, gradientCheckpointing: true,  cacheLatents: true };
  if (vramGb >= 40) return { batchSize: 1,                gradientCheckpointing: true,  cacheLatents: true };
  if (vramGb >= 20) return { batchSize: 1,                gradientCheckpointing: true,  cacheLatents: true };
  return                    { batchSize: 1,                gradientCheckpointing: true,  cacheLatents: false };
}

// Kohya training pod template — only SSH port needed (no Jupyter)
export const KOHYA_POD_TEMPLATE = {
  imageName: "ashleykza/kohya:25.2.1",
  containerDiskInGb: 10,
  volumeInGb: 30,
  volumeMountPath: "/workspace",
  ports: "22/tcp",
};

// Generates ONLY the dataset config TOML passed via --dataset_config.
// Training hyperparameters are passed as CLI args — not valid in this file.
export function generateKohyaConfig(params: {
  triggerWord: string;
  datasetDir: string;
  resolution: number;
  batchSize?: number;
}): string {
  const batchSize = params.batchSize ?? 1;
  return `[general]
enable_bucket = true
shuffle_caption = true
caption_dropout_rate = 0.05
caption_extension = ".txt"
keep_tokens = 1

[[datasets]]
resolution = ${params.resolution}
batch_size = ${batchSize}

  [[datasets.subsets]]
  image_dir = "${params.datasetDir}"
  class_tokens = "${params.triggerWord}"
  num_repeats = 10
  keep_tokens = 1
`;
}
