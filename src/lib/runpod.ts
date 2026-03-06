// RunPod REST API client for pod management and dataset upload

const RUNPOD_BASE = "https://api.runpod.io/graphql";

export interface PodSpec {
  name: string;
  imageName: string;
  gpuTypeId: string;
  cloudType: "SECURE" | "COMMUNITY";
  containerDiskInGb: number;
  volumeInGb: number;
  volumeMountPath: string;
  env: Array<{ key: string; value: string }>;
  ports?: string;
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
  const res = await fetch(RUNPOD_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export async function listGpuTypes(apiKey: string): Promise<Array<{ id: string; displayName: string; memoryInGb: number; secureCloud: boolean; communityCloud: boolean; lowestPrice?: { minimumBidPrice: number; uninterruptablePrice: number } }>> {
  const data = await gql(apiKey, `
    query {
      gpuTypes {
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
  return data.gpuTypes;
}

export async function createPod(apiKey: string, spec: PodSpec): Promise<Pod> {
  const data = await gql(apiKey, `
    mutation CreatePod($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
        name
        status
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
      volumeMountPath: spec.volumeMountPath,
      env: spec.env,
      ports: spec.ports,
      gpuCount: 1,
      minVcpuCount: 2,
      minMemoryInGb: 15,
    }
  });
  return data.podFindAndDeployOnDemand;
}

export async function getPod(apiKey: string, podId: string): Promise<Pod> {
  const data = await gql(apiKey, `
    query GetPod($podId: String!) {
      pod(input: { podId: $podId }) {
        id
        name
        status
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
  return data.pod;
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
          status
          costPerHr
          runtime {
            uptimeInSeconds
          }
        }
      }
    }
  `);
  return data.myself.pods;
}

// GPU recommendations for Kohya SDXL LoRA training
export const RECOMMENDED_GPUS = [
  { id: "NVIDIA A100 80GB PCIe", label: "A100 80GB — Best, ~$2.49 USD/hr", vram: 80 },
  { id: "NVIDIA A100-SXM4-40GB", label: "A100 40GB — Great, ~$1.64 USD/hr", vram: 40 },
  { id: "NVIDIA RTX A6000", label: "RTX A6000 48GB — Good, ~$0.99 USD/hr", vram: 48 },
  { id: "NVIDIA GeForce RTX 3090", label: "RTX 3090 24GB — Budget, ~$0.44 USD/hr", vram: 24 },
];

// Kohya training pod template
export const KOHYA_POD_TEMPLATE = {
  imageName: "kohyass/kohya_ss:latest",
  containerDiskInGb: 20,
  volumeInGb: 30,
  volumeMountPath: "/workspace",
  ports: "7860/http,22/tcp",
};

// Generate Kohya TOML config for SDXL LoRA
export function generateKohyaConfig(params: {
  triggerWord: string;
  datasetDir: string;
  outputDir: string;
  baseModel: string;
  steps: number;
  learningRate: string;
  networkDim: number;
  networkAlpha: number;
  resolution: number;
}): string {
  return `[general]
enable_bucket = true
shuffle_caption = true
caption_dropout_rate = 0.05
caption_extension = ".txt"
keep_tokens = 1

[[datasets]]
resolution = ${params.resolution}
batch_size = 1
keep_tokens = 1

  [[datasets.subsets]]
  image_dir = "${params.datasetDir}"
  class_tokens = "${params.triggerWord}"
  num_repeats = 10

[optimizer_arguments]
learning_rate = ${params.learningRate}
lr_scheduler = "cosine_with_restarts"
lr_warmup_steps = 100
optimizer_type = "AdamW8bit"

[training_arguments]
pretrained_model_name_or_path = "${params.baseModel}"
output_dir = "${params.outputDir}"
output_name = "${params.triggerWord}_lora"
save_model_as = "safetensors"
save_every_n_steps = 100
max_train_steps = ${params.steps}
mixed_precision = "bf16"
save_precision = "fp16"
xformers = true
gradient_checkpointing = true
persistent_data_loader_workers = true
max_data_loader_n_workers = 2

[network_arguments]
network_module = "networks.lora"
network_dim = ${params.networkDim}
network_alpha = ${params.networkAlpha}

[sample_prompt_arguments]
sample_every_n_steps = 100
sample_sampler = "euler_a"
`;
}
