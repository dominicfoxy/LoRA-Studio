import { invoke } from "@tauri-apps/api/core";
import type { NetworkVolume, Pod, PodSpec, SshInfo, GpuPrice } from "./types";

// ── GraphQL pricing (fetch() is fine — external URL) ──────────────────────────

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
  // Note: runpodctl gpu list does not return pricing data — use fetchGpuPrices() for that.
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
  const runtime = res?.data?.pod?.runtime;
  const ports = runtime?.ports as Array<{ ip: string; privatePort: number; publicPort: number }> | undefined;
  if (!ports || ports.length === 0) return null;
  const sshPort = ports.find(p => p.privatePort === 22);
  if (!sshPort || !sshPort.ip || !sshPort.publicPort) return null;
  return { host: sshPort.ip, port: sshPort.publicPort, uptimeInSeconds: runtime?.uptimeInSeconds };
}
