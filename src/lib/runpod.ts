// RunPod REST API client for pod management and dataset upload

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

async function gql(apiKey: string, query: string, variables?: Record<string, unknown>) {
  const json = await invoke<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }>(
    "runpod_graphql",
    { apiKey, query, variables: variables ?? {} }
  );
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data!;
}

export async function listNetworkVolumes(apiKey: string): Promise<NetworkVolume[]> {
  const data = await gql(apiKey, `
    query {
      myself {
        networkVolumes {
          id
          name
          size
          dataCenterId
        }
      }
    }
  `);
  return (data.myself as any).networkVolumes ?? [];
}

export async function listGpuTypes(apiKey: string, dataCenterId?: string): Promise<Array<{ id: string; displayName: string; memoryInGb: number; secureCloud: boolean; communityCloud: boolean; lowestPrice?: { minimumBidPrice: number; uninterruptablePrice: number } }>> {
  // Try datacenter-filtered query first; fall back to global if the field isn't supported
  const tryQuery = async (withDc: boolean) => {
    const input = withDc && dataCenterId ? `(input: { dataCenterId: "${dataCenterId}" })` : "";
    const data = await gql(apiKey, `
      query {
        gpuTypes${input} {
          id
          displayName
          memoryInGb
          secureCloud
          communityCloud
          lowestPrice(input: { gpuCount: 1 }) {
            minimumBidPrice
            uninterruptablePrice
          }
        }
      }
    `);
    return (data as any).gpuTypes as any[];
  };

  if (dataCenterId) {
    try {
      return await tryQuery(true);
    } catch {
      // dataCenterId filter not supported — fall back to global
    }
  }
  return await tryQuery(false);
}

export async function createPod(apiKey: string, spec: PodSpec): Promise<Pod> {
  const data = await gql(apiKey, `
    mutation CreatePod($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
        name
        desiredStatus
        costPerHr
      }
    }
  `, {
    input: {
      name: spec.name,
      imageName: spec.imageName,
      gpuTypeId: spec.gpuTypeId,
      cloudType: spec.cloudType,
      containerDiskInGb: spec.containerDiskInGb,
      volumeInGb: spec.volumeInGb,
      volumeMountPath: spec.volumeMountPath ?? "/workspace",
      env: spec.env,
      ...(spec.ports ? { ports: spec.ports } : {}),
      gpuCount: 1,
      minVcpuCount: 2,
      minMemoryInGb: 15,
      ...(spec.networkVolumeId ? { networkVolumeId: spec.networkVolumeId } : {}),
      ...(spec.dataCenterId ? { dataCenterId: spec.dataCenterId } : {}),
    }
  });
  const pod = data.podFindAndDeployOnDemand as any;
  return { ...pod, status: pod.desiredStatus ?? pod.status ?? "PENDING" };
}

export async function getPod(apiKey: string, podId: string): Promise<Pod> {
  const data = await gql(apiKey, `
    query GetPod($podId: String!) {
      pod(input: { podId: $podId }) {
        id
        name
        desiredStatus
        costPerHr
        runtime {
          uptimeInSeconds
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }
        }
      }
    }
  `, { podId });
  const pod = data.pod as any;
  return { ...pod, status: pod.desiredStatus ?? pod.status ?? "UNKNOWN" };
}

export async function terminatePod(apiKey: string, podId: string): Promise<void> {
  await gql(apiKey, `
    mutation TerminatePod($input: PodTerminateInput!) {
      podTerminate(input: $input)
    }
  `, { input: { podId } });
}

export async function listPods(apiKey: string): Promise<Pod[]> {
  const data = await gql(apiKey, `
    query {
      myself {
        pods {
          id
          name
          desiredStatus
          costPerHr
          runtime {
            uptimeInSeconds
          }
        }
      }
    }
  `);
  return ((data as any).myself.pods as any[]).map((p) => ({ ...p, status: p.desiredStatus ?? p.status ?? "UNKNOWN" }));
}

// GPU recommendations for Kohya SDXL LoRA training
// stepsPerSec: real-world throughput at 1024px SDXL (L40S confirmed at 0.4; others scaled proportionally)
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
// Higher VRAM → larger batch, skip gradient checkpointing, cache latents.
// Adaptive optimizers (Prodigy, DAdaptAdam) store many float32 state tensors per parameter
// and use significantly more VRAM than AdamW8bit — reduce batch size one tier for them.
export function gpuTrainingFlags(vramGb: number, optimizer?: string): GpuTrainingFlags {
  const adaptive = optimizer === "Prodigy" || optimizer === "DAdaptAdam";
  if (vramGb >= 80) return { batchSize: adaptive ? 2 : 4, gradientCheckpointing: false, cacheLatents: true };
  if (vramGb >= 48) return { batchSize: adaptive ? 1 : 2, gradientCheckpointing: false, cacheLatents: true };
  if (vramGb >= 40) return { batchSize: 1,                gradientCheckpointing: true,  cacheLatents: true };
  if (vramGb >= 20) return { batchSize: 1,                gradientCheckpointing: true,  cacheLatents: true };
  return                    { batchSize: 1,                gradientCheckpointing: true,  cacheLatents: false };
}

// Kohya training pod template
export const KOHYA_POD_TEMPLATE = {
  imageName: "ashleykza/kohya-ss:latest",
  containerDiskInGb: 10,
  volumeInGb: 30,
  volumeMountPath: "/workspace",
  ports: "8888/http,7860/http,22/tcp",
};

// Generate Kohya TOML config for SDXL LoRA
// ── Jupyter API helpers ────────────────────────────────────────────────────────
// All Jupyter requests go through Rust/invoke to avoid CORS issues in the webview


export async function jupyterUploadFile(jupyterUrl: string, password: string, remotePath: string, localPath: string): Promise<void> {
  await invoke("jupyter_upload_file", { jupyterUrl, password, remotePath, localPath });
}

export async function jupyterRunCommand(jupyterUrl: string, password: string, command: string): Promise<void> {
  await invoke("jupyter_run_command", { jupyterUrl, password, command });
}


// Generates ONLY the dataset config TOML passed via --dataset_config.
// Training hyperparameters (optimizer, network, steps, etc.) are passed as CLI
// args by the training command — they are NOT valid keys in this file and will
// cause a voluptuous validation error if included.
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
