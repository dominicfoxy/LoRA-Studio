# AGENTS.md

## Core Commands

- `npm run tauri dev` — development mode (starts Vite + Rust simultaneously)
- `npm run tauri build` — production build (creates AppImage)
- `npm run dev` — Vite only (no Tauri shell, for UI-only iteration)
- `npm run build` — tsc + vite build (frontend only)

## Architecture

This is a Tauri 2 desktop app with:
- **Frontend**: React + TypeScript + Zustand (state management)
- **Backend**: Rust (Tauri) for file I/O, HTTP requests, and system operations
- **Forge API**: A1111-compatible REST (`/sdapi/v1/txt2img`)
- **RunPod API**: GraphQL (`api.runpod.io/graphql`)

## Key Constraints

- **HTTP to localhost is blocked** in the Tauri webview. All Forge API calls must go through `invoke()` commands, never `fetch()` to localhost
- **`alert()`, `confirm()`, `open()` are blocked**. Use state-based UI for confirmations
- RunPod GraphQL calls use `fetch()` to `api.runpod.io` — external URLs are fine; only localhost is blocked

## Data Flow

- `BatchGenerator` → calls `invoke("forge_txt2img")` → decodes base64 response → saves via `invoke("save_image_bytes")` → derives caption → adds to store as `GeneratedImage`
- `GeneratedImage.approved` is `true | false | null` — null means unreviewed, false means rejected (eligible for requeue)
- `CaptionEditor` shows approved images; editing updates store caption + calls `invoke("save_caption")`
- `RunPodLauncher` calls `invoke("zip_dataset")` then RunPod GraphQL to spin up a Kohya pod

## Critical File Locations

- `src/store.ts` — Zustand store with `persist` middleware (key: `lora-studio-state`, version 2)
- `src/App.tsx` — Sidebar nav + React Router with routes: `/`, `/shots`, `/generate`, `/captions`, `/runpod`, `/settings`
- `src/lib/forge.ts` — Forge API types, `base64ToBytes()`, `deriveCaption()`
- `src/lib/runpod/` — RunPod module (split from monolithic `runpod.ts`):
  - `types.ts` — interfaces (`Pod`, `PodSpec`, `NetworkVolume`, `SshInfo`, `GpuPrice`, `GpuTrainingFlags`, `SearchResult`)
  - `api.ts` — GraphQL pricing, runpodctl CLI wrappers, pod CRUD, SSH info fetch
  - `ssh.ts` — SSH invoke wrappers (`sshIsReady`, `sshRunCommand`, `sshUploadFile`, `sshDownloadFile`)
  - `gpu.ts` — GPU compatibility, VRAM throughput estimates, training flags
  - `kohya.ts` — `KOHYA_POD_TEMPLATE`, `generateKohyaConfig()`
  - `index.ts` — barrel re-export
- `src-tauri/src/lib.rs` — Tauri builder, `expand_tilde()`, `close_app`
- `src-tauri/src/commands/` — Rust backend split into `forge.rs`, `files.rs`, `runpod.rs`, `pickers.rs`

## Workflow Steps

1. **Character Setup** → Set character name, trigger word, core description, checkpoint filename, output directory
2. **Shot List** → Define shot types (pose, outfit, expression, background), set image count per shot
3. **Batch Generator** → Click **Generate All Shots** → images save to output directory with `.txt` caption sidecars
4. **Caption Editor** → Filter to Approved images → Edit via tag chips or raw textarea → Save All writes all `.txt` sidecars
5. **RunPod Launcher** → Select GPU, cloud type, base model → Set training hyperparameters → Package & Launch

## Prompt Builder Pattern

```ts
[triggerWord, baseDescription, "style of " + artistTags, ...shotFields]
  .filter((s) => s && s.trim())
  .join(", ")
```

Use `.filter((s) => s && s.trim())` — not `.filter(Boolean)` — to eliminate whitespace-only fields that cause double commas.

## Framework Quirks

- Forge API calls must use Tauri's `invoke()` system, not direct HTTP calls
- RunPod GraphQL calls are made directly with `fetch()` to `api.runpod.io`
- Tauri app uses `tauri.conf.json` for configuration, not standard Tauri config files
- The app handles Kohya sd-scripts training automation on RunPod