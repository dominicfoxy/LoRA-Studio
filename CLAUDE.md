# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run tauri dev      # dev mode (starts Vite + Rust simultaneously)
npm run tauri build    # production AppImage
npm run dev            # Vite only (no Tauri shell, for UI-only iteration)
npm run build          # tsc + vite build (frontend only)
```

There are no tests in this project.

## Architecture

LoRA Studio is a Tauri 2 desktop app for end-to-end character LoRA dataset creation. The workflow is linear:

**Character Setup → Shot List → Batch Generator → Caption Editor → RunPod Launcher**

### Frontend (React + TypeScript)

- `src/store.ts` — Zustand store with `persist` middleware (key: `lora-studio-state`, version 2). Single source of truth for `character`, `generation` (`GenerationConfig`), `images`, and `settings`. All pages read/write via `useStore`. `GenerationConfig` holds `poses/outfits/expressions/backgrounds: string[]`, `extras`, `loras`, `count`, `width`, `height` — the generator takes the cartesian product of all four dimensions.
- `src/App.tsx` — Sidebar nav + React Router. Routes: `/`, `/shots`, `/generate`, `/captions`, `/runpod`, `/settings`.
- `src/pages/` — One file per workflow step.
- `src/lib/forge.ts` — Forge API types, `base64ToBytes()`, `deriveCaption()` (strips LoRA tags/weight syntax/quality tokens, prepends trigger word).
- `src/lib/runpod.ts` — RunPod GraphQL helpers, `generateKohyaConfig()` for TOML generation, GPU recommendations.

### Backend (Rust / Tauri)

All file I/O and HTTP requests are handled in `src-tauri/src/lib.rs`. Registered `invoke` commands:

| Command | Purpose |
|---|---|
| `pick_directory` | Native folder picker (dialog plugin) |
| `forge_txt2img` | POST to Forge `/sdapi/v1/txt2img` (300s timeout) |
| `forge_get_models` | GET Forge model list |
| `forge_get_progress` | GET Forge generation progress |
| `save_caption` / `load_caption` | Read/write `.txt` sidecar next to image |
| `read_image_b64` | Read image file as base64 |
| `save_image_bytes` | Write raw bytes to path (creates dirs) |
| `list_images_in_dir` | List PNG/JPG/WEBP in a directory |
| `delete_image` | Delete image + its `.txt` sidecar |
| `zip_dataset` | Zip a directory for RunPod upload |
| `save_project` / `load_project` | Read/write `project.json` |
| `ensure_dir` | `create_dir_all` |
| `list_lora_files` | List `.safetensors`/`.pt`/`.ckpt` files (depth 2) |

## Critical Tauri Constraints

- **HTTP to localhost is blocked** in the Tauri webview. All Forge API calls must go through `invoke("forge_txt2img", ...)` — never use `fetch()` to localhost.
- **`alert()`, `confirm()`, `open()` are blocked.** Use state-based UI for confirmations. Use `invoke("pick_directory")` for folder selection.
- RunPod GraphQL calls (`src/lib/runpod.ts`) use `fetch()` to `api.runpod.io` — external URLs are fine; only localhost is blocked.

## Data Flow

- `BatchGenerator` calls `invoke("forge_txt2img")`, decodes base64 response with `base64ToBytes()`, saves via `invoke("save_image_bytes")`, derives caption with `deriveCaption()`, and adds to store as `GeneratedImage`.
- `GeneratedImage.approved` is `true | false | null` — null means unreviewed, false means rejected (eligible for requeue).
- `CaptionEditor` shows approved images; editing updates store caption + calls `invoke("save_caption")`.
- `RunPodLauncher` calls `invoke("zip_dataset")` then RunPod GraphQL to spin up a Kohya pod.

## Prompt Builder Pattern

```ts
[triggerWord, baseDescription, "style of " + artistTags, ...shotFields]
  .filter((s) => s && s.trim())
  .join(", ")
```

Use `.filter((s) => s && s.trim())` — not `.filter(Boolean)` — to eliminate whitespace-only fields that cause double commas.
