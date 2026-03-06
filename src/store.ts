import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface GenerationConfig {
  poses: string[];
  outfits: string[];
  expressions: string[];
  backgrounds: string[];
  extras: string;
  loras: string[];
  count: number;
  width: number;
  height: number;
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

export interface AppSettings {
  forgeUrl: string;
  comfyUrl: string;
  runpodApiKey: string;
  defaultOutputDir: string;
}

export interface ProjectState {
  character: CharacterConfig;
  generation: GenerationConfig;
  images: GeneratedImage[];
  settings: AppSettings;

  setCharacter: (c: Partial<CharacterConfig>) => void;
  setSettings: (s: Partial<AppSettings>) => void;
  updateGeneration: (patch: Partial<GenerationConfig>) => void;
  addImage: (img: GeneratedImage) => void;
  updateImage: (id: string, patch: Partial<GeneratedImage>) => void;
  removeImage: (id: string) => void;
  clearImages: () => void;
  importProject: (data: Partial<ProjectState>) => void;
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
};

const defaultGeneration: GenerationConfig = {
  poses: [],
  outfits: [],
  expressions: [],
  backgrounds: [],
  extras: "",
  loras: [],
  count: 1,
  width: 1024,
  height: 1024,
};

export const useStore = create<ProjectState>()(
  persist(
    (set) => ({
      character: defaultCharacter,
      generation: defaultGeneration,
      images: [],
      settings: defaultSettings,

      setCharacter: (c) => set((s) => ({ character: { ...s.character, ...c } })),
      setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
      updateGeneration: (patch) => set((s) => ({ generation: { ...s.generation, ...patch } })),

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
        })),
    }),
    {
      name: "lora-studio-state",
      version: 2,
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
            count: sh?.count ?? 1,
            width: sh?.width ?? 1024,
            height: sh?.height ?? 1024,
          };
          delete state.shots;
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
