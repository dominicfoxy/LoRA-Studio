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
  learningRate: string;
  networkDim: number;
  resolution: number;
  networkVolumeId: string;
  baseModelLocalPath: string;
  baseModelDownloadUrl: string;
  containerDiskInGb: number;
  sdxl: boolean;
  optimizer: "AdamW8bit" | "Prodigy" | "DAdaptAdam";
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
  runpodActiveJupyterUrl: string;
  setRunpodActivePodId: (id: string) => void;
  setRunpodActiveJupyterUrl: (url: string) => void;
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
  learningRate: "1e-4",
  networkDim: 64,
  resolution: 1024,
  networkVolumeId: "",
  baseModelLocalPath: "",
  baseModelDownloadUrl: "",
  containerDiskInGb: 40,
  sdxl: true,
  optimizer: "AdamW8bit",
};

const defaultSettings: AppSettings = {
  forgeUrl: "http://localhost:7860",
  comfyUrl: "http://localhost:8188",
  runpodApiKey: "",
  defaultOutputDir: "",
  recentProjects: [],
  uiScale: 1.0,
  volumeContents: {},
  dockerImage: "ashleykza/kohya:latest",
  activeTheme: "default",
  themeFile: "",
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
  samplerName: "DPM++ 2M Karras",
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
      updateGeneration: (patch) => set((s) => ({ generation: { ...s.generation, ...patch }, isDirty: true })),
      updateTraining: (patch) => set((s) => ({ training: { ...s.training, ...patch } })),
      setGenerationRunning: (running) => set({ generationRunning: running }),
      setGenerationProgress: (current, total) => set({ generationProgress: { current, total } }),
      setGenerationCurrentJob: (job) => set({ generationCurrentJob: job }),
      addRunpodLog: (msg) => set((s) => ({ runpodLogs: [...s.runpodLogs, msg] })),
      clearRunpodLogs: () => set({ runpodLogs: [] }),
      markSaved: () => set({ isDirty: false }),
      runpodActivePodId: "",
      runpodActiveJupyterUrl: "",
      setRunpodActivePodId: (id) => set({ runpodActivePodId: id }),
      setRunpodActiveJupyterUrl: (url) => set({ runpodActiveJupyterUrl: url }),

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
      version: 15,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as any;
        // v0: flat string fields on shot items
        if (version === 0) {
          const sh = state.shots?.[0];
          state.generation = {
            poses: sh?.pose ? [sh.pose] : [],
            outfits: sh?.outfit ? [sh.outfit] : [],
            expressions: sh?.expression ? [sh.expression] : [],
            backgrounds: sh?.background ? [sh.background] : [],
            extras: sh?.extras ?? "",
            loras: [],
            count: sh?.count ?? 1,
            width: sh?.width ?? 1024,
            height: sh?.height ?? 1024,
          };
          delete state.shots;
        }
        // v1: shots was ShotItem[] with array fields — promote first shot
        if (version === 1) {
          const sh = state.shots?.[0];
          state.generation = {
            poses: sh?.poses ?? [],
            outfits: sh?.outfits ?? [],
            expressions: sh?.expressions ?? [],
            backgrounds: sh?.backgrounds ?? [],
            extras: sh?.extras ?? "",
            loras: sh?.loras ?? [],
            positiveEmbeddings: [],
            negativeEmbeddings: [],
            count: sh?.count ?? 1,
            width: sh?.width ?? 1024,
            height: sh?.height ?? 1024,
          };
          delete state.shots;
        }
        // v2: generation exists but is missing embedding fields
        if (version === 2) {
          state.generation = {
            ...defaultGeneration,
            ...state.generation,
            positiveEmbeddings: state.generation?.positiveEmbeddings ?? [],
            negativeEmbeddings: state.generation?.negativeEmbeddings ?? [],
          };
        }
        // v3: missing sampler/scheduler/steps/cfg fields
        if (version === 3) {
          state.generation = {
            ...defaultGeneration,
            ...state.generation,
            steps: state.generation?.steps ?? 28,
            cfgScale: state.generation?.cfgScale ?? 7,
            samplerName: state.generation?.samplerName ?? "DPM++ 2M Karras",
            scheduler: state.generation?.scheduler ?? "Karras",
          };
        }
        // v5: poses was string[] — promote to PoseEntry[]
        if (version === 5) {
          state.generation = {
            ...defaultGeneration,
            ...state.generation,
            poses: (state.generation?.poses ?? []).map((p: unknown) =>
              typeof p === "string" ? { prompt: p } : p
            ),
          };
        }
        // v4: outfits was string[] — promote to OutfitEntry[]
        if (version === 4) {
          state.generation = {
            ...defaultGeneration,
            ...state.generation,
            outfits: (state.generation?.outfits ?? []).map((o: unknown) =>
              typeof o === "string" ? { prompt: o } : o
            ),
          };
        }
        if (version === 6) {
          state.training = defaultTraining;
        }
        // v7→8: add networkVolumeId to training, volumeContents to settings
        if (version === 7) {
          state.training = { ...defaultTraining, ...state.training, networkVolumeId: "", baseModelLocalPath: "", baseModelDownloadUrl: "" };
          state.settings = { ...defaultSettings, ...state.settings, volumeContents: {} };
        }
        // v8→9: move dockerImage from training to settings
        if (version === 8) {
          const inheritedImage = (state.training as any)?.dockerImage;
          state.settings = { ...defaultSettings, ...state.settings, dockerImage: inheritedImage || defaultSettings.dockerImage };
          const training = { ...(state.training ?? {}) } as any;
          delete training.dockerImage;
          state.training = { ...defaultTraining, ...training };
        }
        // v9→10: add containerDiskInGb to training
        if (version === 9) {
          state.training = { ...defaultTraining, ...state.training, containerDiskInGb: defaultTraining.containerDiskInGb };
        }
        // ensure dockerImage always present regardless of migration path
        if (!state.settings?.dockerImage) {
          state.settings = { ...defaultSettings, ...state.settings, dockerImage: defaultSettings.dockerImage };
        }
        // v10→11: add genMode/randomCount to generation
        if (version === 10) {
          state.generation = { ...defaultGeneration, ...state.generation, genMode: "all", randomCount: 10 };
        }
        // v11→12: add sdxl flag to training
        if (version === 11) {
          state.training = { ...defaultTraining, ...state.training, sdxl: true };
        }
        // v12→13: bump default steps 2000→1500, networkDim 32→64, drop xformers (handled in training command)
        if (version === 12) {
          state.training = { ...defaultTraining, ...state.training, steps: 1500, networkDim: 64 };
        }
        // v13→14: add optimizer field
        if (version === 13) {
          state.training = { ...state.training, optimizer: "AdamW8bit" };
        }
        // v14→15: add theme fields to settings
        if (version === 14) {
          state.settings = { ...defaultSettings, ...state.settings, activeTheme: "default", themeFile: "" };
        }
        // ensure theme fields always present regardless of migration path
        if (!state.settings?.activeTheme) {
          state.settings = { ...defaultSettings, ...state.settings, activeTheme: "default", themeFile: "" };
        }
        // ensure containerDiskInGb always present regardless of migration path
        if (!state.training?.containerDiskInGb) {
          state.training = { ...defaultTraining, ...state.training, containerDiskInGb: defaultTraining.containerDiskInGb };
        }
        // ensure sdxl always present regardless of migration path
        if (state.training?.sdxl === undefined) {
          state.training = { ...defaultTraining, ...state.training, sdxl: true };
        }
        // ensure optimizer always present regardless of migration path
        if (!state.training?.optimizer) {
          state.training = { ...defaultTraining, ...state.training, optimizer: "AdamW8bit" };
        }
        return state;
      },
      partialize: (state) => ({
        character: state.character,
        generation: state.generation,
        training: state.training,
        images: state.images,
        settings: state.settings,
      }),
    }
  )
);
