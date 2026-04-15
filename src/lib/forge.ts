// Forge WebUI utilities — prompt building, caption derivation, base64 decoding.
// All actual Forge HTTP calls go through Tauri invoke() to the Rust backend
// (localhost is blocked in the Tauri webview).

// Normalize a prompt segment: trim whitespace and leading/trailing commas.
// Use this on every field before joining into a prompt.
export function normSeg(s: string | undefined | null): string {
  if (!s) return "";
  return s.trim().replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

export function base64ToBytes(b64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new Error("Forge returned an invalid image (base64 decode failed — malformed API response)");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Build a Dynamic Prompts compatible block from the current shot list config.
// Syntax: {v1|v2|v3} picks one at random per image; single variants emit as plain text.
export function buildDynamicPromptsBlock(
  character: { triggerWord: string; species: string; baseDescription: string; artistTags: string },
  generation: {
    poses: { prompt: string }[];
    outfits: { prompt: string; triggerWord?: string }[];
    expressions: string[];
    backgrounds: string[];
    extras: string;
  }
): string {
  const prefixParts = [
    character.species,
    character.baseDescription,
    character.artistTags ? `style of ${character.artistTags}` : "",
  ].map(normSeg).filter((s) => s.length > 0);

  function buildGroup(variants: string[]): string {
    const filtered = variants.map(normSeg).filter((s) => s.length > 0);
    if (filtered.length === 0) return "";
    if (filtered.length === 1) return filtered[0];
    return `{${filtered.join("|")}}`;
  }

  const poseGroup = buildGroup(generation.poses.map((p) => p.prompt));
  const expressionGroup = buildGroup(generation.expressions);

  // Outfits: prepend per-entry triggerWord inside the group if set
  const outfitVariants = generation.outfits
    .map((o) => [o.triggerWord, o.prompt].map(normSeg).filter((s) => s.length > 0).join(", "))
    .filter((s) => s.length > 0);
  const outfitGroup =
    outfitVariants.length === 0 ? "" :
    outfitVariants.length === 1 ? outfitVariants[0] :
    `{${outfitVariants.join("|")}}`;

  const backgroundGroup = buildGroup(generation.backgrounds);
  const extras = normSeg(generation.extras);

  return [
    ...prefixParts,
    poseGroup,
    expressionGroup,
    outfitGroup,
    backgroundGroup,
    extras,
  ].filter((s) => s && s.trim().length > 0).join(", ");
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
