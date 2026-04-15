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
  uptimeInSeconds?: number;
}

export interface GpuPrice {
  secure: number;   // uninterruptablePrice
  community: number; // minimumBidPrice
}

export interface GpuTrainingFlags {
  batchSize: number;
  gradientCheckpointing: boolean;
  cacheLatents: boolean;
}

export interface SearchResult {
  source: "civitai" | "huggingface";
  label: string;
  sublabel: string;
  downloadUrl: string;
}
