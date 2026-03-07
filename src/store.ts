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

export interface AppSettings {
  forgeUrl: string;
  comfyUrl: string;
  runpodApiKey: string;
  defaultOutputDir: string;
  recentProjects: RecentProject[];
  uiScale: number;
}

export interface ProjectState {
  character: CharacterConfig;
  generation: GenerationConfig;
  images: GeneratedImage[];
  settings: AppSettings;
  generationRunning: boolean;
  generationProgress: { current: number; total: number };
  generationCurrentJob: string;

  setCharacter: (c: Partial<CharacterConfig>) => void;
  setSettings: (s: Partial<AppSettings>) => void;
  updateGeneration: (patch: Partial<GenerationConfig>) => void;
  addImage: (img: GeneratedImage) => void;
  updateImage: (id: string, patch: Partial<GeneratedImage>) => void;
  removeImage: (id: string) => void;
  clearImages: () => void;
  importProject: (data: Partial<ProjectState>) => void;
  setGenerationRunning: (running: boolean) => void;
  setGenerationProgress: (current: number, total: number) => void;
  setGenerationCurrentJob: (job: string) => void;
  isDirty: boolean;
  markSaved: () => void;
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

const defaultSettings: AppSettings = {
  forgeUrl: "http://localhost:7860",
  comfyUrl: "http://localhost:8188",
  runpodApiKey: "",
  defaultOutputDir: "",
  recentProjects: [],
  uiScale: 1.0,
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
};

export const useStore = create<ProjectState>()(
  persist(
    (set) => ({
      character: defaultCharacter,
      generation: defaultGeneration,
      images: [],
      settings: defaultSettings,
      generationRunning: false,
      generationProgress: { current: 0, total: 0 },
      generationCurrentJob: "",
      isDirty: false,

      setCharacter: (c) => set((s) => ({ character: { ...s.character, ...c }, isDirty: true })),
      setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
      updateGeneration: (patch) => set((s) => ({ generation: { ...s.generation, ...patch }, isDirty: true })),
      setGenerationRunning: (running) => set({ generationRunning: running }),
      setGenerationProgress: (current, total) => set({ generationProgress: { current, total } }),
      setGenerationCurrentJob: (job) => set({ generationCurrentJob: job }),
      markSaved: () => set({ isDirty: false }),

      addImage: (img) => set((s) => ({ images: [...s.images, img] })),
      updateImage: (id, patch) =>
        set((s) => ({ images: s.images.map((im) => (im.id === id ? { ...im, ...patch } : im)) })),
      removeImage: (id) => set((s) => ({ images: s.images.filter((im) => im.id !== id) })),
      clearImages: () => set({ images: [] }),

      importProject: (data) =>
        set((s) => ({
          character: data.character ?? s.character,
          generation: data.generation ?? s.generation,
          images: data.images ?? s.images,
          settings: data.settings ?? s.settings,
          isDirty: false,
        })),
    }),
    {
      name: "lora-studio-state",
      version: 6,
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
        return state;
      },
      partialize: (state) => ({
        character: state.character,
        generation: state.generation,
        images: state.images,
        settings: state.settings,
      }),
    }
  )
);
