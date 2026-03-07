// Forge WebUI A1111-compatible REST client

export interface Txt2ImgParams {
  prompt: string;
  negative_prompt?: string;
  steps?: number;
  cfg_scale?: number;
  width?: number;
  height?: number;
  sampler_name?: string;
  seed?: number;
  batch_size?: number;
  n_iter?: number;
  override_settings?: Record<string, unknown>;
}

export interface Txt2ImgResponse {
  images: string[]; // base64 encoded PNGs
  parameters: Record<string, unknown>;
  info: string;
}

export async function txt2img(
  baseUrl: string,
  params: Txt2ImgParams
): Promise<Txt2ImgResponse> {
  const url = `${baseUrl}/sdapi/v1/txt2img`;
  const body: Txt2ImgParams = {
    steps: 28,
    cfg_scale: 7,
    width: 1024,
    height: 1024,
    sampler_name: "DPM++ 2M Karras",
    seed: -1,
    batch_size: 1,
    negative_prompt: "lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
    ...params,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Forge API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function getProgress(baseUrl: string): Promise<{
  progress: number;
  eta_relative: number;
  state: { job: string; sampling_step: number; sampling_steps: number };
  current_image?: string;
}> {
  const res = await fetch(`${baseUrl}/sdapi/v1/progress`);
  if (!res.ok) throw new Error(`Progress error: ${res.status}`);
  return res.json();
}

export async function interruptGeneration(baseUrl: string): Promise<void> {
  await fetch(`${baseUrl}/sdapi/v1/interrupt`, { method: "POST" });
}

export async function getModels(baseUrl: string): Promise<Array<{ title: string; model_name: string; filename: string }>> {
  const res = await fetch(`${baseUrl}/sdapi/v1/sd-models`);
  if (!res.ok) throw new Error(`Models error: ${res.status}`);
  return res.json();
}

export async function setModel(baseUrl: string, checkpoint: string): Promise<void> {
  await fetch(`${baseUrl}/sdapi/v1/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sd_model_checkpoint: checkpoint }),
  });
}

// Normalize a prompt segment: trim whitespace and leading/trailing commas.
// Use this on every field before joining into a prompt.
export function normSeg(s: string | undefined | null): string {
  if (!s) return "";
  return s.trim().replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Derive booru-style caption from a generation prompt.
// Strips character identity tags (species, appearance, artist style) so the
// LoRA learns those from the trigger word alone.  Retains per-image variable
// tags: pose, outfit, expression, background, extras.
export function deriveCaption(
  prompt: string,
  triggerWord: string,
  characterContext?: { species: string; baseDescription: string; artistTags: string }
): string {
  // Remove lora syntax: <lora:...>
  let clean = prompt.replace(/<lora:[^>]+>/g, "");
  // Remove weight syntax: (tag:1.2) -> tag
  clean = clean.replace(/\(([^:)]+):\d+\.?\d*\)/g, "$1");
  // Remove plain parens used for emphasis: (tag) -> tag
  clean = clean.replace(/\(([^)]+)\)/g, "$1");

  // Build set of character-identity tags to strip
  const stripSet = new Set<string>();
  if (characterContext) {
    const { species, baseDescription, artistTags } = characterContext;
    const identityFields = [species, baseDescription, artistTags, artistTags ? `style of ${artistTags}` : ""];
    for (const field of identityFields) {
      normSeg(field).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).forEach((t) => stripSet.add(t));
    }
  }

  const QUALITY_TOKENS = /^(masterpiece|best quality|high quality|highres|absurdres|ultra-detailed|8k|4k)$/;

  const tags = clean
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && !QUALITY_TOKENS.test(t) && !stripSet.has(t));

  // Deduplicate
  const unique = [...new Set(tags)];

  // Ensure trigger word is first
  const withoutTrigger = unique.filter((t) => t !== triggerWord.toLowerCase());
  if (triggerWord) withoutTrigger.unshift(triggerWord.toLowerCase());

  return withoutTrigger.join(", ");
}
