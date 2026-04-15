import type { GpuTrainingFlags } from "./types";

// Pre-Ampere GPUs that lack native bf16 — training uses --mixed_precision bf16.
// Matched case-insensitively against GPU displayName.
const PRE_AMPERE_PATTERNS = [/\bV100\b/i, /\bT4\b/i, /\bRTX\s*20/i, /\bP100\b/i, /\bP40\b/i, /\bK80\b/i];

// Returns true if the GPU is suitable for Kohya LoRA training:
// - Ampere+ architecture (bf16 support)
// - At least 10GB VRAM (below that, better to train locally)
export function isGpuCompatible(displayName: string, vramGb: number): boolean {
  if (vramGb < 10) return false;
  return !PRE_AMPERE_PATTERNS.some(p => p.test(displayName));
}

// Infer approximate steps/sec at 1024px SDXL from VRAM tier.
// L40S (48GB) confirmed at ~0.4 steps/sec; others scaled proportionally.
export function stepsPerSecForVram(vramGb: number): number {
  if (vramGb >= 80) return 0.70;
  if (vramGb >= 48) return 0.40;
  if (vramGb >= 40) return 0.45;
  if (vramGb >= 24) return 0.25;
  return 0.15;
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
