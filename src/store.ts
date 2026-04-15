import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OutfitEntry {
  prompt: string;
  triggerWord?: string;
  loras?: string[];
}

export interface PoseEntry {
  prompt: string;
  loras?: string[];
}

export interface GenerationConfig {
  poses: PoseEntry[];
  outfits: OutfitEntry[];
  expressions: string[];
  backgrounds: string[];
  extras: string;
  loras: string[];
  positiveEmbeddings: string[];
  negativeEmbeddings: string[];
  count: number;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  samplerName: string;
  scheduler: string;
  genMode: "all" | "random";
  randomCount: number;
}

export interface GeneratedImage {
  id: string;
  shotId: string;
  path: string;
  prompt: string;
  caption: string;
  approved: boolean | null;
  seed: number;
  width: number;
  height: number;
}

export interface CharacterConfig {
  name: string;
  triggerWord: string;
  species: string;
  baseDescription: string;
  artistTags: string;
  outputDir: string;
  baseModel: string;
  loraDir: string;
}

export interface RecentProject {
  name: string;
  outputDir: string;
}

export interface VolumeContents {
  datasetKey: string;   // "{triggerWord}_{zipMtime}" — used to detect stale uploads
  modelName: string;    // base model filename on the volume
  uploadedAt: string;   // ISO timestamp
}

export interface TrainingConfig {
  gpuTypeId: string;
  cloudType: "SECURE" | "COMMUNITY" | "ALL";
  steps: number;
  unetLr: string;
  textEncoderLr: string;
  networkDim: number;
  networkAlpha: number;
  noiseOffset: number;
  minSnrGamma: number;
  resolution: number;
  networkVolumeId: string;
  baseModelLocalPath: string;
  baseModelDownloadUrl: string;
  containerDiskInGb: number;
  sdxl: boolean;
  vPrediction: boolean;
  optimizer: "AdamW8bit" | "Prodigy" | "DAdaptAdam";
  prodigyDCoef: number;
  weightDecay: number;
}

export interface AppSettings {
  forgeUrl: string;
  comfyUrl: string;
  runpodApiKey: string;
  defaultOutputDir: string;
  recentProjects: RecentProject[];
  uiScale: number;
  volumeContents: Record<string, VolumeContents>; // keyed by volumeId
  dockerImage: string;
  activeTheme: string;   // built-in theme id, e.g. "default"
  themeFile: string;     // absolute path to a custom theme JSON (empty = none)
  ezMode: boolean;       // guided/beginner mode — locks technical fields, auto-applies sensible defaults
  sshKeyPath: string;    // path to ed25519 private key registered with RunPod (~/.config/lora-studio/runpod_id_ed25519)
  favourites: {
    poses: string[];
    outfits: string[];
    expressions: string[];
    backgrounds: string[];
  };
}

export interface ProjectState {
  character: CharacterConfig;
  generation: GenerationConfig;
  training: TrainingConfig;
  images: GeneratedImage[];
  settings: AppSettings;
  generationRunning: boolean;
  generationProgress: { current: number; total: number };
  generationCurrentJob: string;
  runpodLogs: string[];

  setCharacter: (c: Partial<CharacterConfig>) => void;
  setSettings: (s: Partial<AppSettings>) => void;
  updateFavourites: (category: keyof AppSettings["favourites"], updater: (prev: string[]) => string[]) => void;
  updateGeneration: (patch: Partial<GenerationConfig>) => void;
  updateTraining: (patch: Partial<TrainingConfig>) => void;
  addImage: (img: GeneratedImage) => void;
  updateImage: (id: string, patch: Partial<GeneratedImage>) => void;
  removeImage: (id: string) => void;
  clearImages: () => void;
  importProject: (data: Partial<ProjectState>) => void;
  setGenerationRunning: (running: boolean) => void;
  setGenerationProgress: (current: number, total: number) => void;
  setGenerationCurrentJob: (job: string) => void;
  addRunpodLog: (msg: string) => void;
  clearRunpodLogs: () => void;
  isDirty: boolean;
  markSaved: () => void;
  projectLoadCount: number;
  // Active RunPod session — in-memory only (not persisted), survives page navigation
  runpodActivePodId: string;
  runpodActiveSshHost: string;
  runpodActiveSshPort: number;
  runpodUptimeSec: number | null;
  runpodCostPerHr: number | null;
  setRunpodActivePodId: (id: string) => void;
  setRunpodActiveSshHost: (host: string) => void;
  setRunpodActiveSshPort: (port: number) => void;
  setRunpodUptimeSec: (sec: number | null) => void;
  setRunpodCostPerHr: (cost: number | null) => void;
}

const defaultCharacter: CharacterConfig = {
  name: "",
  triggerWord: "",
  species: "",
  baseDescription: "",
  artistTags: "",
  outputDir: "",
  baseModel: "",
  loraDir: "",
};

const defaultTraining: TrainingConfig = {
  gpuTypeId: "NVIDIA A100-SXM4-40GB",
  cloudType: "SECURE",
  steps: 1500,
  unetLr: "5e-5",
  textEncoderLr: "1e-5",
  networkDim: 32,
  networkAlpha: 16,
  noiseOffset: 0.0357,
  minSnrGamma: 5,
  resolution: 1024,
  networkVolumeId: "",
  baseModelLocalPath: "",
  baseModelDownloadUrl: "",
  containerDiskInGb: 40,
  sdxl: true,
  vPrediction: false,
  optimizer: "AdamW8bit",
  prodigyDCoef: 2,
  weightDecay: 0.01,
};

export const defaultSettings: AppSettings = {
  forgeUrl: "http://localhost:7860",
  comfyUrl: "http://localhost:8188",
  runpodApiKey: "",
  defaultOutputDir: "",
  recentProjects: [],
  uiScale: 1.0,
  volumeContents: {},
  dockerImage: "ashleykza/kohya:25.2.1",
  activeTheme: "default",
  themeFile: "",
  ezMode: false,
  sshKeyPath: "",
  favourites: {
    poses: [
      "portrait, close-up, looking at viewer, head and shoulders",
      "upper body, looking at viewer, hands visible",
      "cowboy shot, casual stance, looking at viewer",
      "standing, full body, arms at sides, looking at viewer",
      "sitting, relaxed pose, looking at viewer",
      "from behind, looking over shoulder, upper body",
      "from above, looking up at viewer, foreshortening",
      "walking, mid-stride, natural movement, full body",
      "leaning against wall, arms crossed, three-quarter view",
      "kneeling, hands on knees, low angle",
    ],
    outfits: [
      "casual outfit, jeans, plain t-shirt, sneakers",
      "formal suit, dress shirt, tie, polished shoes",
      "sundress, light fabric, bare shoulders",
      "hoodie, sweatpants, relaxed fit",
      "sportswear, athletic tank top, running shorts",
      "business casual, button-up shirt, chinos",
      "leather jacket, dark jeans, boots",
      "swimsuit, barefoot",
      "school uniform, blazer, pleated skirt",
      "nude",
    ],
    expressions: [
      "neutral expression, relaxed face",
      "smiling, warm expression, looking at viewer",
      "serious expression, composed, direct gaze",
      "laughing, open mouth, genuine joy",
      "looking away, thoughtful expression, profile",
      "confident smirk, slight smile, raised eyebrow",
      "surprised expression, wide eyes, open mouth",
      "sad expression, downcast eyes, soft frown",
    ],
    backgrounds: [
      "simple background, solid white background, studio lighting",
      "simple background, solid grey background, soft lighting",
      "outdoors, forest clearing, dappled sunlight, trees",
      "outdoors, city street, urban, golden hour lighting",
      "indoors, cozy bedroom, natural window light",
      "indoors, modern office, clean, fluorescent lighting",
      "outdoors, beach, ocean waves, bright sunny day",
      "studio background, dramatic rim lighting, dark backdrop",
    ],
  },
};

const defaultGeneration: GenerationConfig = {
  poses: [],
  outfits: [],
  expressions: [],
  backgrounds: [],
  extras: "",
  loras: [],
  positiveEmbeddings: [],
  negativeEmbeddings: [],
  count: 1,
  width: 1024,
  height: 1024,
  steps: 28,
  cfgScale: 7,
  samplerName: "DPM++ 2M",
  scheduler: "Karras",
  genMode: "all",
  randomCount: 10,
};

export const useStore = create<ProjectState>()(
  persist(
    (set) => ({
      character: defaultCharacter,
      generation: defaultGeneration,
      training: defaultTraining,
      images: [],
      settings: defaultSettings,
      projectLoadCount: 0,
      generationRunning: false,
      generationProgress: { current: 0, total: 0 },
      generationCurrentJob: "",
      runpodLogs: [],
      isDirty: false,

      setCharacter: (c) => set((s) => ({ character: { ...s.character, ...c }, isDirty: true })),
      setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
      updateFavourites: (category, updater) => set((st) => {
        const favs = st.settings.favourites ?? defaultSettings.favourites;
        return { settings: { ...st.settings, favourites: { ...favs, [category]: updater(favs[category]) } } };
      }),
      updateGeneration: (patch) => set((s) => ({ generation: { ...s.generation, ...patch }, isDirty: true })),
      updateTraining: (patch) => set((s) => ({ training: { ...s.training, ...patch } })),
      setGenerationRunning: (running) => set({ generationRunning: running }),
      setGenerationProgress: (current, total) => set({ generationProgress: { current, total } }),
      setGenerationCurrentJob: (job) => set({ generationCurrentJob: job }),
      addRunpodLog: (msg) => set((s) => ({ runpodLogs: [...s.runpodLogs, msg] })),
      clearRunpodLogs: () => set({ runpodLogs: [] }),
      markSaved: () => set({ isDirty: false }),
      runpodActivePodId: "",
      runpodActiveSshHost: "",
      runpodActiveSshPort: 0,
      runpodUptimeSec: null,
      runpodCostPerHr: null,
      setRunpodActivePodId: (id) => set({ runpodActivePodId: id }),
      setRunpodActiveSshHost: (host) => set({ runpodActiveSshHost: host }),
      setRunpodActiveSshPort: (port) => set({ runpodActiveSshPort: port }),
      setRunpodUptimeSec: (sec) => set({ runpodUptimeSec: sec }),
      setRunpodCostPerHr: (cost) => set({ runpodCostPerHr: cost }),

      addImage: (img) => set((s) => ({ images: [...s.images, img] })),
      updateImage: (id, patch) =>
        set((s) => ({ images: s.images.map((im) => (im.id === id ? { ...im, ...patch } : im)), isDirty: true })),
      removeImage: (id) => set((s) => ({ images: s.images.filter((im) => im.id !== id) })),
      clearImages: () => set({ images: [] }),

      importProject: (data) =>
        set((s) => ({
          character: data.character ?? s.character,
          generation: data.generation ?? s.generation,
          images: data.images ?? s.images,
          settings: data.settings ?? s.settings,
          isDirty: false,
          projectLoadCount: s.projectLoadCount + 1,
        })),
    }),
    {
      name: "lora-studio-state",
      version: 23,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as any;

        // ── Legacy structural transforms (v0–v16) ──────────────────────
        // These change data shape/types and must run for users upgrading
        // from very old versions. After v16 every migration was just
        // "add field with default", which the deep-merge below handles.

        if (version <= 1) {
          // v0-v1: shots array → generation object
          const sh = state.shots?.[0];
          state.generation = {
            poses: (sh?.poses ?? (sh?.pose ? [sh.pose] : [])).map(
              (p: unknown) => (typeof p === "string" ? { prompt: p } : p)
            ),
            outfits: (sh?.outfits ?? (sh?.outfit ? [sh.outfit] : [])).map(
              (o: unknown) => (typeof o === "string" ? { prompt: o } : o)
            ),
            expressions: sh?.expressions ?? (sh?.expression ? [sh.expression] : []),
            backgrounds: sh?.backgrounds ?? (sh?.background ? [sh.background] : []),
            extras: sh?.extras ?? "",
            loras: sh?.loras ?? [],
            count: sh?.count ?? 1,
            width: sh?.width ?? 1024,
            height: sh?.height ?? 1024,
          };
          delete state.shots;
        }
        if (version >= 2 && version <= 5) {
          // v4-v5: promote string[] poses/outfits to entry objects
          if (Array.isArray(state.generation?.outfits)) {
            state.generation.outfits = state.generation.outfits.map(
              (o: unknown) => (typeof o === "string" ? { prompt: o } : o)
            );
          }
          if (Array.isArray(state.generation?.poses)) {
            state.generation.poses = state.generation.poses.map(
              (p: unknown) => (typeof p === "string" ? { prompt: p } : p)
            );
          }
        }
        if (version <= 8) {
          // v8: move dockerImage from training to settings
          const inheritedImage = (state.training as any)?.dockerImage;
          if (inheritedImage) {
            state.settings = { ...(state.settings ?? {}), dockerImage: inheritedImage };
            delete (state.training as any).dockerImage;
          }
        }
        if (version <= 16) {
          // v16: split learningRate → unetLr/textEncoderLr
          const oldLr = (state.training as any)?.learningRate;
          if (oldLr) {
            state.training = { ...(state.training ?? {}), unetLr: oldLr };
            delete (state.training as any).learningRate;
          }
        }
        if (version <= 20) {
          // v15: reduce networkDim 64→32 (was briefly bumped in v12)
          if (state.training?.networkDim === 64) {
            state.training = { ...state.training, networkDim: 32 };
          }
          // v20: pin :latest docker image variants
          const img = state.settings?.dockerImage ?? "";
          if (img === "ashleykza/kohya:latest" || img === "ashleykza/kohya-ss:latest") {
            state.settings = { ...(state.settings ?? {}), dockerImage: "ashleykza/kohya:25.2.1" };
          }
        }

        // ── Deep merge with defaults ────────────────────────────────────
        // Any new field added to defaults is automatically picked up.
        // No more per-version "add field" migrations or "ensure X" guards.
        state.character = { ...defaultCharacter, ...(state.character ?? {}) };
        state.generation = { ...defaultGeneration, ...(state.generation ?? {}) };
        state.training = { ...defaultTraining, ...(state.training ?? {}) };
        state.settings = { ...defaultSettings, ...(state.settings ?? {}) };

        return state;
      },
      partialize: (state) => ({
        character: state.character,
        generation: state.generation,
        training: state.training,
        images: state.images,
        settings: state.settings,
        runpodActivePodId: state.runpodActivePodId,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ProjectState>;
        return {
          ...current,
          ...p,
          // Deep-merge settings so new default fields (e.g. favourites) always appear
          settings: { ...defaultSettings, ...(p.settings ?? {}) },
        };
      },
    }
  )
);
