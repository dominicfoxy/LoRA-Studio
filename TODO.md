# LoRA Studio — TODO

## Bugs

### Medium
- [ ] **Training time estimate is approximate** — `stepsPerSecForVram()` infers throughput from VRAM tier (L40S 48GB confirmed at ~0.4 steps/sec, others scaled). Needs profiling against more GPU types to improve accuracy.

---

## Planned Features

### Shot List
- [x] Custom/favourite presets per category — editable favourites per category, stored globally in settings

### Batch Generator
- [x] Auto-select "All Combos" mode by default — already the default (`genMode: "all"` in store)

### Caption Editor
- [ ] Import images from an existing folder — load external or manually created images into the caption workflow

### RunPod Launcher

### Cross-App / Ecosystem
- [x] **Shared theme files** — portability note added to custom theme file hint in Settings

### General / Future
- [ ] **Localisation (i18n)** — all strings are currently hardcoded in English. Defer until there is concrete demand from a non-English community.
- [ ] Character preset gallery — save and reload full character configs (separate from project save)
- [ ] **Optional built-in inference backend** — opt-in download of a local Forge/A1111 instance
- [ ] **ComfyUI backend support** — alternative to Forge. Needs workflow JSON builder, LoRA prompt tags → `LoraLoader` nodes, 3 new Rust commands, and `backendType` setting routing in BatchGenerator.

---

## Code Quality / Technical Debt

- [ ] **`lib.rs` module split** — split into `commands/forge.rs`, `commands/files.rs`, `commands/runpod.rs`, `commands/pickers.rs`

### Refactor Audit (2026-04-07)

Full codebase audit for assumptions made during AI-assisted development that were never re-evaluated as scope changed. Organized by impact tier.

---

#### Critical — Blocks Future Features

- [ ] **RunPodLauncher.tsx is a 2,268-line god component** — Manages pod lifecycle, SSH, file upload/download, log streaming, polling timers, GPU pricing, volume management, model search, and uptime tracking in a single component with 50+ local state variables. This blocks adding any RunPod feature without risking regressions.
  - *Fix:* Split into sub-components by concern: `PodConfig`, `SshConnection`, `TrainingLog`, `ModelSearch`, `GpuSelector`, `VolumeManager`. Each gets its own file under `src/components/runpod/`.

- [x] **Module-level mutable state survives HMR and leaks across mounts** — `RunPodLauncher.tsx:40-45` declares `_podPollId`, `_logPollId`, `_sshWaitId`, `_uploadInProgress`, `_connectedPodId` at module scope. If the component remounts during an upload, `_uploadInProgress` stays stale; if user navigates away mid-poll, timers keep firing.
  - *Fix:* Move to `useRef` inside the component with `useEffect` cleanup functions. Use `AbortController` for fetch-based polling.

- [x] **Store migrations are a brittle 200-line imperative cascade (23 versions)** — `store.ts:327-541` is a sequence of `if (version === N)` blocks that spread `...defaultSettings` to fill missing fields, plus ~50 lines of "ensure X always present" fallbacks at the bottom. One missed field silently breaks hydration. The migrations are also out of order (v19 appears before v17).
  - *Fix:* Replace with declarative schema validation (Zod). Define the target schema, validate persisted state against it, and use `.parse()` with `.default()` fallbacks. Eliminates all migration code — new fields just get a default in the schema.

- [x] **`forge.ts` uses `fetch()` directly to localhost** — `src/lib/forge.ts:40` calls `fetch(url, ...)` where `url` is `http://localhost:7860/...`. This violates the critical Tauri constraint documented in CLAUDE.md: "HTTP to localhost is blocked in the Tauri webview." The Rust backend has `forge_txt2img` / `forge_get_models` / `forge_get_progress` commands specifically to work around this, but `forge.ts` also exports `txt2img()`, `getProgress()`, `getModels()`, `setModel()`, and `interruptGeneration()` which use raw `fetch()`. If any page calls these instead of `invoke()`, they silently fail in production builds.
  - *Fix:* Remove the `fetch()`-based functions from `forge.ts` or convert them to `invoke()` wrappers. Audit all call sites to ensure they use the Rust backend. Add corresponding Rust commands for `setModel` and `interruptGeneration` if needed.

---

#### Major — Causes Rework Risk

- [ ] **Tight coupling: every page destructures 10-20 store selectors inline** — e.g. `RunPodLauncher.tsx:48` destructures the entire store in one line. No abstraction layer between pages and store shape. Any store restructure requires updating every page.
  - *Fix:* Create domain-specific custom hooks: `useCharacter()`, `useGeneration()`, `useImages()`, `useTraining()`, `useRunpod()`. Pages consume hooks, not raw store.

- [ ] **No component library — PageHeader (40 lines) is the only reusable component** — All UI is inline JSX with massive `style={{...}}` objects. Buttons, inputs, dialogs, cards, badges are all duplicated across pages with slightly different styles.
  - *Fix:* Extract shared components: `Button`, `Input`, `Select`, `Dialog`, `Card`, `Badge`, `Tooltip`. Start with components that appear on 3+ pages.

- [ ] **Duplicated Forge API client logic** — `BatchGenerator.tsx` calls `invoke("forge_txt2img", ...)` inline with its own error handling. Meanwhile `forge.ts` exports wrapper functions that also call the same endpoints (some via `fetch()`, some could use `invoke()`). Two parallel interfaces for the same API.
  - *Fix:* Single `forgeService.ts` that exclusively uses `invoke()` for all Forge calls. All pages import from this one module.

- [ ] **`importProject` does no validation** — `store.ts:314` accepts `Partial<ProjectState>` and spreads it directly into state with `data.character ?? s.character`. A corrupted or hand-edited `project.json` could inject invalid state (wrong types, missing fields, extra fields) with no error.
  - *Fix:* Validate imported data against the Zod schema (same one used for migration replacement). Reject or sanitize invalid fields with user-visible feedback.

- [ ] **String-based error messages from Rust with no error codes** — All Rust commands return `Err(String)`. Frontend can't distinguish transient errors (network timeout) from fatal errors (file not found) from user errors (invalid path). This prevents implementing retry logic or contextual error messages.
  - *Fix:* Define a Rust error enum with categories (Io, Network, Validation, External). Serialize as `{ code: string, message: string }`. Frontend can pattern-match on code.

- [ ] **`training` field not included in `importProject`** — `store.ts:314-322`: `importProject` restores `character`, `generation`, `images`, and `settings`, but not `training`. If a user saves a project with custom training hyperparameters and reloads it, training config resets to defaults.
  - *Fix:* Add `training: data.training ?? s.training` to `importProject`. Also add `training` to `save_project` serialization in `App.tsx:103`.

---

#### Moderate — Architectural Oddities

- [ ] **`partialize` persists `runpodActivePodId` but not the rest of RunPod session state** — `store.ts:549` includes `runpodActivePodId` in persisted fields, but `runpodActiveSshHost`, `runpodActiveSshPort`, `runpodUptimeSec`, and `runpodCostPerHr` are excluded. On app restart, the pod ID is restored but SSH connection info is lost, causing a half-reconnected state.
  - *Fix:* Either persist all RunPod session fields together, or persist none (and re-derive on launch by querying the pod ID via GraphQL).

- [ ] **EZ mode has no consistent lock/disable pattern** — `ezMode` flag hides technical fields on some pages, disables them on others, and is ignored on the rest. No single source of truth for which fields are "advanced."
  - *Fix:* Create a `useEzMode()` hook that returns `{ isEz, isFieldVisible(fieldName) }` with a central registry of which fields are hidden in EZ mode.

- [ ] **CSS variable coupling with no fallback layer** — Hardcoded theme var names like `var(--accent-bright)`, `var(--bg-1)` scattered across all pages. Settings nav link (App.tsx:195-198) has hardcoded `SAFE_*` color constants as a workaround for broken themes. If theme structure changes, all pages break.
  - *Fix:* Define CSS custom property fallbacks in a base stylesheet. Remove the `SAFE_*` hardcoded colors — they're a symptom of the fragility.

- [ ] **File path handling is split between Rust and TypeScript** — `expand_tilde()` in Rust (`lib.rs:7-16`) handles `~` expansion. TypeScript also does string concatenation for paths (`${dir}/${file}`). No shared path utility; potential for double-slash or missing-slash bugs.
  - *Fix:* All path construction happens in Rust. Frontend sends raw segments; backend joins them. Remove TS-side path concatenation.

- [ ] **`save_project` / `load_project` are generic string I/O commands** — `files.rs:129-141`: These take a path and a raw string. They're used for both project JSON and theme JSON loading (App.tsx:64 uses `load_project` to load theme files). The naming is misleading and the lack of typing means any string gets written.
  - *Fix:* Rename to `write_file` / `read_file` (what they actually are), or add typed project-specific commands that validate JSON structure.

- [ ] **Polling timers in RunPodLauncher lack coordinated cleanup** — Multiple `setInterval` calls for pod status, log tailing, SSH readiness, and uptime tracking. If user navigates away, some timers keep running because cleanup relies on module-level variables rather than React lifecycle.
  - *Fix:* Consolidate into a single polling manager (custom hook or context) that starts/stops all timers together and cleans up on unmount.

- [ ] **`list_lora_files` has no depth limit** — `files.rs:161`: `WalkDir::new(path)` with no `.max_depth()`. If pointed at a large directory tree, it recursively scans everything. Compare with `list_images_in_dir` which correctly uses `.max_depth(1)`.
  - *Fix:* Add `.max_depth(2)` (as documented in CLAUDE.md) or make depth configurable.

---

#### Minor — Code Smells

- [ ] **`GeneratedImage.approved` is a tri-state boolean** — `store.ts:41`: `approved: boolean | null` where null = unreviewed, false = rejected, true = approved. This works but is implicit. A union type (`"approved" | "rejected" | "unreviewed"`) would be self-documenting.

- [ ] **Favourites are untyped string arrays** — `store.ts:104-109`: No metadata (last-used, custom vs. default, sort order). Fine for now but limits future features like "recently used" or "sort by frequency."

- [ ] **`deriveCaption` strips quality tokens with a hardcoded regex** — `forge.ts:178`: `QUALITY_TOKENS` list is static. If Forge adds new quality tokens or the user uses custom ones, they leak into captions. Low risk but could cause training data noise.

- [ ] **`zip_dataset` reads entire files into memory** — `files.rs:98-104`: Each file is read into a `Vec<u8>` buffer before writing to the zip. For large datasets (hundreds of 1024x1024 PNGs), this could spike memory usage. Streaming would be more efficient.

- [ ] **No form validation on Character Setup** — Trigger word accepts any string including spaces, uppercase, and special characters. Kohya training may behave unexpectedly with non-standard trigger words.

- [ ] **`runpodctl` install is Linux-amd64 only** — `runpod.rs:36`: Hardcoded download URL `runpodctl-linux-amd64`. Won't work on macOS or ARM Linux despite Tauri supporting those platforms.

- [ ] **Store migration versions are out of order in source** — `store.ts`: v19→20 appears at line 452, but v17→18 at line 472 and v16→17 at line 475. The code works because each `if` is independent, but it makes the migration history hard to follow.

- [ ] **`KOHYA_POD_TEMPLATE.imageName` duplicates `defaultSettings.dockerImage`** — `runpod.ts:248` hardcodes `"ashleykza/kohya:25.2.1"` and `store.ts:195` has the same string in `defaultSettings`. If one is updated without the other, the template and settings diverge.
