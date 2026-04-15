# LoRA Studio — Changelog

## [v1.1.1-alpha]

- **Split `lib/runpod.ts` into submodules** — broke the 282-line monolithic `runpod.ts` into `lib/runpod/types.ts` (interfaces), `api.ts` (GraphQL + runpodctl wrappers), `ssh.ts` (SSH invoke wrappers), `gpu.ts` (compatibility/throughput/training flags), `kohya.ts` (pod template + dataset config generation), and `index.ts` (barrel re-export). `RunPodLauncher.tsx` imports unchanged — barrel preserves all public API. `SearchResult` interface moved from component-local to `types.ts`.
- **Comprehensive refactor audit** — deep-interviewed requirements, then audited the full codebase for AI-generated assumptions that were never re-evaluated as scope changed. Added 25 findings to TODO.md organized by impact tier (Critical → Minor), each with a concrete fix plan.
- **Fix: remove dead fetch-to-localhost code from forge.ts** — removed `txt2img()`, `getProgress()`, `getModels()`, `setModel()`, `interruptGeneration()` and their interfaces (`Txt2ImgParams`, `Txt2ImgResponse`). These used `fetch()` to localhost which is blocked in Tauri's webview. None were called — all pages correctly use `invoke()` to the Rust backend. Only utility functions remain (`normSeg`, `base64ToBytes`, `deriveCaption`, `buildDynamicPromptsBlock`).
- **Fix: move module-level timer state to useRef in RunPodLauncher** — `_podPollId`, `_logPollId`, `_sshWaitId`, `_uploadInProgress`, `_connectedPodId` were module-scope `let` variables that could leak timers and stale state across navigations. Now stored in `useRef` hooks, governed by React lifecycle and cleaned up on unmount.
- **Fix: replace 200-line store migration cascade with deep-merge** — the 23-version `if (version === N)` chain plus ~50 lines of "ensure X present" guards is replaced by: legacy structural transforms (v0–v20 for data shape changes like shots→generation, string[]→PoseEntry[], learningRate split) followed by a single deep-merge pass that spreads current defaults under persisted values. New fields now automatically get defaults — no migration code needed.

- **Theme file portability note** — custom theme file hint in Settings now mentions that theme JSON files are portable across all apps using the same design system.
- **Editable favourite presets on Shot List** — replaced hardcoded preset arrays with user-editable favourites per category (poses, outfits, expressions, backgrounds). Favourites are always visible as chips below each category, persist across sessions, and ship with descriptive multi-tag defaults for EZ Mode users. Star icon on each variant row saves/unsaves to favourites. `+ favourite` button adds custom entries inline.
- **Split `lib.rs` into submodules** — broke the monolithic 624-line `lib.rs` into `commands/forge.rs`, `commands/files.rs`, `commands/runpod.rs`, and `commands/pickers.rs`. `lib.rs` now just holds `expand_tilde()`, `close_app`, and the Tauri builder. Removed unused `ImageEntry` struct.
- **Reduce Claude Code token usage** — split global `~/.claude/CLAUDE.md` (538 lines) into a lean 71-line core + `~/.claude/design-baseline.md` (484 lines, loaded on demand for UI work only). Trimmed project MEMORY.md from 110 to 25 lines by removing code-derivable content and moving RunPod gotchas to a separate file. Moved cross-project feedback rules to global `~/.claude/memory/`.

---

## [v1.1.0-alpha]

- **Remove force-download button** — the "Force-start download" escape hatch during training is no longer needed now that completion detection and reconnect are reliable. The "Retry Download" button (shown on actual download failures) remains.
- **Remove post-launch diagnostic dump** — the 8s SSH diagnostic after training launch was useful for debugging but redundant now that the log filter shows model loading progress. Removed to reduce noise.
- **Fix log errors after pod termination** — poll intervals (pod status, log polling, SSH wait) were cleared after `terminatePod()` returned, but the async gap let them fire one more time against a dying pod, spamming SSH errors into the log. Now cleared before the terminate call in both auto-terminate and manual terminate paths.
- **Fix tilde (~) expansion in all file paths** — output dir `~/joltyguy` was taken literally by the Rust backend, creating a `src-tauri/~/joltyguy` directory instead of `/home/user/joltyguy`. Added `expand_tilde()` helper applied to every path-accepting Rust command (save, load, zip, delete, browse, SSH upload/download, etc.).
- **Selective purge** — the Purge confirmation banner now offers "Unapproved only" (deletes pending + rejected, keeps approved) alongside "Delete all". The unapproved count is shown on the button. Only appears when there are both approved and unapproved images.
- **Fix cost estimate and uptime resetting on tab switch** — `podUptimeSec` and `costPerHr` were local React state that reset to null on component unmount (navigating away from RunPod tab). Moved both to the Zustand store (non-persisted, like SSH host/port) so they survive tab switches. Cost per hour is also stored when the pod is created and on each poll tick.
- **Fix uptime showing local estimate instead of real pod uptime** — `getPod` (via `runpodctl pod get`) doesn't return `uptimeInSeconds`. The GraphQL query in `getSshInfo` had the real value but was discarding it. Now `getSshInfo` returns `uptimeInSeconds` and the poll tick syncs it to the uptime display on every tick, so the counter shows the actual pod uptime rather than a locally-interpolated guess.
- **Fix GPU VRAM lookup race** — `liveGpuTypes` was local React state that could be null when `uploadToVolume` ran (async fetch hadn't completed yet), causing "GPU VRAM unknown" and falling back to conservative training flags. Now uses a ref kept in sync with state, and `uploadToVolume` does an inline fetch if the ref is null before computing training flags.
- **Fix docker image fallback using `:latest` instead of pinned version** — the `imageName` fallback in `RunPodLauncher` used `ashleykza/kohya:latest` when `settings.dockerImage` was empty, bypassing the pinned `:25.2.1` version. The `:latest` image likely has a different directory layout that caused silent training failures.
- **Fix training appearing stuck during model loading** — the log polling filter only matched training-phase keywords (loss, epoch, step) and silently dropped all model loading output. On an A5000 with SDXL, loading the U-Net alone takes ~15 minutes — the user saw zero output the entire time. Expanded the filter to include: `loading`, `building`, `prepare`, `launcher:`, `matched successfully`, `train images`, `bucket`. Status line now shows "Loading model…" and "Preparing dataset…" during pre-training phases. Also: first 10 lines of training.log always surfaced, and a warning fires if zero output after 3 minutes.
- **Post-launch diagnostic** — 8 seconds after launching training, SSH back into the pod and dump the training log + process list. This catches immediate failures (script not found, python missing) that would otherwise go unnoticed until the stale-log warning fires 3 minutes later.
- **Design system v1.1 migration** — updated `--border` from `#2e2e33` to `#35353b` (was identical to `--bg-4`, making card borders invisible on elevated backgrounds). Added `.btn-icon` global CSS class for icon-only buttons with proper hover states.
- **Inline LoRA weight editing on attached tags** — click the weight number on an attached LoRA tag to edit it in place. Commits on Enter/blur, reverts on Escape or invalid value. No need to remove and re-add to change weight.
- **Fix LoRA weight input rejecting empty values** — the weight field in the LoRA picker snapped back to 0.8 immediately on clear, making it impossible to type a new value without awkward selection. Now stores raw string during editing and only validates/reverts on blur.
- **Fix LoRA picker dropdown clipped inside section cards** — the Poses/Outfits section wrappers had `overflow: hidden` which clipped the absolutely-positioned LoRA dropdown. Removed `overflow: hidden` from all ShotList section cards and added explicit `borderRadius` to headers instead.
- **EZ mode generator defaults updated** — changed from DPM++ 2M / Karras / 20 steps to Euler a / Automatic / 30 steps / CFG 7.
- **Filter incompatible GPUs from selector** — GPUs below 10GB VRAM or pre-Ampere (V100, T4, RTX 20xx, P100, P40, K80) are hidden from the GPU picker. Pre-Ampere GPUs lack native bf16 support required by `--mixed_precision bf16`, and sub-10GB GPUs aren't worth renting over training locally.
- **Remove `RECOMMENDED_GPUS` hardcoded list** — GPU selector, VRAM-based training flags, time estimates, and best-value badges now all derive from the live `runpodctl gpu list` data. If the live list can't be fetched (no API key / network issue), the GPU selector shows a prompt instead of stale hardcoded entries. `stepsPerSecForVram()` replaces the per-GPU throughput values with a VRAM-tier lookup.
- **Fix dataset zip including rejected/unapproved images** — `zip_dataset` was zipping ALL image+caption files in the output directory, including images the user explicitly rejected. Now `packageDataset` passes only approved image paths to the Rust command, so the training dataset contains exactly the curated set. The `zip_dataset` Rust command accepts an optional `includePaths` parameter; when omitted, falls back to the old behavior (zip everything).
- **Fix SSH reconnect after app restart** — three issues: (1) `runpodActivePodId` was not in Zustand `partialize`, lost on restart so auto-reconnect never fired. (2) Poll tick used `settings.runpodApiKey` from a stale closure instead of `apiKeyRef.current`, so the API key was empty when polling started before Zustand hydration. This caused `runpodctl ssh info` to fail with "api key not found", silently returning null forever. (3) `linkPod` and auto-reconnect now use `checkFirst: true` on SSH wait so they check pod state instead of re-uploading. Also: `getSshInfo` now throws on real errors (e.g. missing API key) instead of silently returning null.
- **Live pod uptime + estimated cost** — pod status card now shows a live-ticking uptime (h/m/s) and running cost estimate (`costPerHr × uptime`). Uptime is seeded from the pod's `runtime.uptimeInSeconds` on each poll tick and interpolated every second between polls. Fixed timer resetting every 15s: split into two useEffects — one for the 1s interval (keyed on `podStatus`), one for syncing poll data (keyed on `polledUptime`) — so the interval no longer restarts on every poll tick.
- **Style guide compliance pass** — added missing `--red-bright` and `--blue-dim` CSS vars to `:root`, `DEFAULT_VARS`, and all 7 built-in themes. Replaced ~20 hardcoded `#d47070` references across 5 files with `var(--red-bright)` so reject/error colors now respond to theme changes. Full `--text-muted` audit across all pages: hint text, empty states, instruction text, metadata labels, variant counts, stat labels, volume/GPU card metadata, model search sublabels, section headers, and training status messages all changed to `--text-secondary`. `--text-muted` now reserved for disabled/inactive elements only (toggle inactive states, row indices, decorative icons, action icon buttons).
- **Fix migration v4/v5 block order** in `store.ts` — v5 appeared before v4, now in correct sequential order.
- **Remove stray `src-tauri/~/sibyl/` directory** — leftover from a mistyped shell command.
- **Fix false positive on training duplicate check** — `pgrep -f sdxl_train_network` (and later `accelerate.*train_network`) matched container startup processes on fresh `ashleykza/kohya` pods, preventing training from starting. Replaced with a file-based check: training is considered active only if `/workspace/training.log` exists and was modified in the last 30 seconds. Immune to container process tree false positives.
- **Fix OOM on 48GB GPUs (A6000, L40S)** — `gpuTrainingFlags` had `gradientCheckpointing: false` for the 48GB tier, causing SDXL training to OOM at batch size 2. Now enabled; only 80GB+ GPUs skip gradient checkpointing.
- **SSH info via GraphQL API** — replaced `runpodctl ssh info` (which returned "pod not ready" for running pods) with a direct GraphQL query for `runtime.ports`. New `fetch_pod_ssh` Rust command.
- **RunPod backend migrated from GraphQL + Jupyter → runpodctl + SSH** — completely replaced the two-layer integration (GraphQL for pod lifecycle, Jupyter REST/WebSocket for on-pod operations) with `runpodctl` CLI (pod create/get/list/remove, SSH key registration, GPU/volume listing) and standard `ssh`/`scp` for all on-pod operations. Eliminates the fragile multi-step XSRF authentication, base64 upload limits, and WebSocket terminal complexity that required multiple rewrites.
- **Setup panel on RunPod Launcher** — new guided setup flow at top of config panel: step 1 checks/installs `runpodctl` (auto-downloads from GitHub releases to `~/.local/bin/`); step 2 generates an ed25519 SSH keypair at `~/.config/lora-studio/runpod_id_ed25519` and registers the public key with RunPod via `runpodctl ssh add-key`. Guards `Launch Pod` if SSH key not yet configured.
- **Incremental log polling** — `startLogPolling` now uses `awk 'NR>N'` to fetch only new lines per tick instead of loading the full `training.log` file every 5 seconds. For long SDXL training runs this was reading 50MB+ per tick; now only the delta is transferred.
- **Pod status card shows SSH command instead of Jupyter URL** — "Open Jupyter" button replaced with a monospace `root@host -p port` label (click to copy).
- **Store v22** — `runpodActiveJupyterUrl` replaced with `runpodActiveSshHost` + `runpodActiveSshPort` (in-memory); `sshKeyPath` added to persisted `AppSettings` (default `""`). Migration: automatic.
- **KOHYA_POD_TEMPLATE ports simplified** — `"8888/http,7860/http,22/tcp"` → `"22/tcp"` (Jupyter and Gradio ports no longer needed).
- **Cargo.toml trimmed** — removed `urlencoding`, `tokio-tungstenite`, `native-tls`, `futures-util`; removed unused `multipart` and `cookies` features from `reqwest` (still needed by Forge API commands).
- **Hybrid GPU pricing** — runpodctl doesn't expose per-GPU pricing, so `fetchGpuPrices` queries the RunPod GraphQL API via a new `fetch_gpu_prices` Rust command (CORS blocks direct `fetch()` from the webview). Prices are merged with the runpodctl GPU list by `displayName`.
- **Best value GPU badge** — computed from `stepsPerSec / pricePerHr` for GPUs in `RECOMMENDED_GPUS` that have live pricing. Highlights the most cost-effective GPU for training based on the selected cloud type.
- **runpodctl flag fixes** — `--json` flag doesn't exist; runpodctl uses `--output json` (default). Removed the flag since JSON is the default output format. GPU ID field is `gpuId`, not `id`.
- **SSH key registration fix** — `setup_ssh_key` was passing the public key file path to `runpodctl ssh add-key --key` instead of the key content. Key was never actually registered. Now reads the `.pub` file and passes the content string. Also always re-registers on each call (skip keygen only, not registration).
- **`getSshInfo` handles "pod not ready"** — runpodctl returns `{"error":"pod not ready"}` while pod is starting. Now returns `null` instead of throwing, and the poll tick silently retries.
- **Pod terminate cleanup** — `terminateCurrentPod` and auto-terminate now properly stop all polling intervals, clear SSH state, and reset `runpodActivePodId`. Previously left stale intervals running and reconnect would fire on tab switch.
- **Tab-switch reconnect fix** — `_connectedPodId` is now reset on component unmount, so navigating away and back correctly re-establishes the connection instead of silently skipping reconnect.
- **`launchPod` re-registers SSH key** — calls `setupSshKey` before every `createPod` to ensure the key is current on RunPod's side.
- **Setup panel always visible** — was hidden once `sshKeyPath` was set, making re-registration impossible. Now always shows with "Re-register" button and async feedback (Registering… → ✓ Registered → idle).
- **Async button feedback pattern** — added to global design language (CLAUDE.md). Buttons that trigger async actions show `working → ✓ done (2s) → idle` or `working → Failed (3s) → idle` states with color changes.

- **Status bar** — thin bar at the bottom of the main content area showing active character name, trigger word, approved/total image count, unsaved-changes indicator, and EZ/pro mode label.
- **"Don't Panic 🧻" hint in EZ mode log** — while training is in progress (pipelineStep 3, no halt/failure), a gentle italic reminder appears below the status line: "Don't Panic — it's supposed to be slow".
- **Tab-switch reconnect fixed** — navigating away from and back to the RunPod page was re-running the full reconnect flow (reading training.log, restarting polling) every visit. Now tracked via a module-level `_connectedPodId` — reconnect only fires once per pod session; navigating between tabs no longer causes duplicate log entries or poll restarts.
- **Launch button spam-click guard** — `launchPod` now returns early if `phase === "training"` is already set, preventing double-taps from creating multiple pods.
- **"yelluuuu ~~~ <3" theme** — new yellow/gold dark theme added to the theme list.

---

## [v1.0.6-alpha]

- **EZ Mode** — beginner-friendly toggle in the sidebar footer. When active, all technical fields are locked (disabled + dimmed) with auto-computed values, and sensible defaults are applied automatically. Covers RunPodLauncher (hyperparameters, GPU, cloud type), GeneratorSettings (steps, CFG, sampler, scheduler), ShotList (image size, count, embeddings, LoRA weights), and BatchGenerator (mode, requeue, purge). A simplified log view replaces raw Kohya output with a large step counter + progress bar. Hover tooltips on locked fields explain the auto value and how to unlock. Store migrated to v20.
- **"Sensible defaults" button in Training Hyperparameters** — auto-populates optimizer, LRs, dim, alpha, resolution, noise offset, min SNR gamma, and steps based on model type (SDXL/SD1.5) and approved image count. Step formula: `images × 60` clamped 1500–3000 for SDXL; `images × 40` clamped 1000–2000 for SD1.5. Step suggestion hint updated to match (was `images × 100`).
- **Prodigy / DAdaptAdam: expose `d_coef` and `weight_decay` in UI** — previously hardcoded at `d_coef=2` and `weight_decay=0.01`. Both are now user-configurable fields shown when an adaptive optimizer is selected (`d_coef` is Prodigy-only). Prodigy also now includes `safeguard_warmup=True` in optimizer args. Store migrated to v19.
- **Confirmation dialogs now disable underlying action buttons** — while any confirm banner is visible in BatchGenerator (purge, generate, large queue), the Generate/Purge/Requeue/Stop buttons are disabled to prevent accidental double-fires. Applied consistently across all pages: RunPodLauncher Terminate button now has a `terminating` in-progress state; Force Download and Retry Download disabled while a download is active; Launch Pod opacity-only disable bug fixed (was visual-only, button was still clickable). CharacterSetup New Character button disabled while its confirm banner is shown. App close dialog Save/Discard buttons disabled during save to prevent double-invocations.
- **Large batch confirmation** — queues over 50 images now prompt before generating, with a note that LoRAs typically train well on 20–50 images. Proceeding runs the already-built queue without rebuilding it.
- **Jupyter readiness detection is now fast and hang-resistant** — `jupyter_is_ready` was calling the full login flow (3 HTTP requests, 60s timeout each), so each failed probe could block for minutes and concurrent calls piled up. Now uses a single lightweight GET to `/login` with an 8s timeout. Frontend poll interval reduced from 15s to 5s, first check fires immediately on `startJupyterWait` instead of waiting for the first tick, and an overlap guard prevents concurrent calls if a check takes longer than the interval.
- **"Waiting for pod to start" ticker no longer sticks when linking to a running pod** — fix: `stopPodTicker()` now always fires when the pod is seen as RUNNING, regardless of ref state.
- **Kohya docker image pinned to `ashleykza/kohya:25.2.1`** — default was `ashleykza/kohya:latest`; `KOHYA_POD_TEMPLATE` had the defunct `ashleykza/kohya-ss:latest`. Pinning prevents silent breakage when the upstream image is updated. Store v20→21 migration updates existing users still on a `:latest` variant. To upgrade intentionally, change the Docker Image field in Settings.
- **`base64ToBytes` now throws a readable error on malformed Forge responses** — `atob()` exceptions were uncaught and would surface as a cryptic JS error. Now wrapped in try/catch with a clear message that propagates to the generation error banner.
- **Training log line numbers stripped more completely** — now strips leading timestamp and `LEVEL     source.py:N: ` prefix in addition to trailing `\tfilename.py:N`.
- **Width/height validated before batch generation** — invalid dimensions (zero or not divisible by 8) now show a clear error pointing to Sampler settings.
- **Download log message now accounts for filtered intermediates** — now shows `skipping N intermediate(s)` count when intermediates are filtered out.
- **Copy Training Command now shows the correct model filename** — was using `config.baseModelLocalPath / baseModelDownloadUrl`; now uses `character.baseModel` to match the actual launch path.
- **Purge failures now surfaced when using "purge and generate"** — failure count now shown via the same banner as the standalone purge.
- **App icon** — updated to new couch artwork.
- **LICENSE file** — PolyForm Noncommercial 1.0.0 added to repo root.
- **Disclaimer** — "not affiliated with" and "provided as-is" text added to README and Settings About section.

---

## [v1.0.5a-alpha]

- **Link pod now runs `checkAndResume` instead of re-uploading** — the "Link" button on detected running pods was routing through `startJupyterWait` → `uploadToVolume`, ignoring `.extract_done` / `.model_manifest` and always re-uploading the dataset and config. It now calls `checkAndResume` once Jupyter is ready, matching the reconnect path.
- **Training step counter shows global progress, not per-epoch** — Kohya outputs two tqdm bars (per-epoch and global). The status line was picking up the per-epoch bar (`0/41`) instead of the global one (`0/1500`). Now tracks the largest total seen across tqdm lines and only updates the status when the current bar's total matches that maximum.
- **`checkAndResume` no longer triggers false download mid-training** — was checking for any `.safetensors` in `/workspace/output/`, which includes intermediate checkpoint saves. Now checks the `.training_done` sentinel (only written on clean training exit). If dataset and model are ready but training is not done, resumes log polling instead of relaunching or downloading prematurely.
- **Stale status ticker on upload/download error fixed** — if a zip upload, model upload, or LoRA download failed mid-transfer, the elapsed-time ticker kept running and overwrote the cleared status line with a stale "Uploading… (Xs)" every second. All three ticker usages are now wrapped in try/finally so the interval is always cleared on error. `downloadOutputs` error path also now clears `uploadStatus`.

---

## [v1.0.5-alpha]

- **Dynamic prompts export no longer includes character trigger word** — the trigger word is only meaningful when the character LoRA is loaded; the export is used before the LoRA exists. Outfit-level trigger words (for pre-existing outfit LoRAs) are unaffected.
- **Batch generation no longer OOMs Forge** — added `override_settings_restore_afterwards: false` alongside the model checkpoint override. Previously Forge was restoring the original checkpoint after every single image (its default), causing it to load and unload the model on each generation — briefly holding two copies in VRAM and OOMing on longer batches.
- **Generator Settings: sampler list cleaned up** — removed old Karras/SDE-suffixed sampler names (`DPM++ 2M Karras`, `DPM++ 2M SDE Karras`, etc.) since the separate scheduler dropdown already handles the noise schedule. Mixing both paradigms in one list was confusing.
- **Generator Settings: default sampler** changed from `DPM++ 2M Karras` to `DPM++ 2M` — correctly pairs with the existing `Karras` scheduler default instead of embedding the schedule in both places.
- **Generator Settings: steps max** raised from 80 to 150; hint updated to note Euler a / DDIM benefit from more steps than DPM++ samplers.
- **Generator Settings: CFG hint** now covers both SDXL/Illustrious (5–9) and SD1.5 (7) rather than assuming Illustrious only.

- **Split UNet / Text Encoder learning rates** — the single LR field is replaced by separate **UNet LR** (default `5e-5`) and **Text Encoder LR** (default `1e-5`) fields. Both are passed as `--unet_lr` / `--text_encoder_lr` in the training command (adaptive optimizers still use `--learning_rate 1.0` as before). Store migrated to v17; existing `learningRate` value is carried forward as the new `unetLr`.
- **Network Alpha field** — exposed in the hyperparameters UI (default 16). Previously hardcoded to `floor(networkDim / 2)`; now user-controlled. Disabled in adaptive optimizer mode (forced to 1).
- **Noise Offset field** — configurable in UI (default `0.0357`). Still only applied for SD1.x (skipped for SDXL). Set to 0 to disable.
- **Min SNR Gamma field** — re-added to UI (default 5, was removed in v1.0.4). Emits `--min_snr_gamma` when > 0; set to 0 to disable.
- **V-Prediction mode toggle** — checkbox in Training Hyperparameters. When enabled, adds `--v_parameterization --zero_terminal_snr` to the training command. Required for NoobAI-XL and other v-pred models; must be left off for standard SDXL (epsilon). Store migrated to v18.
- **Status line no longer scrolls off** — `uploadStatus` moved outside the log scroll container so it stays pinned at the top of the log panel.
- **Copy Training Command button** — in the Training Hyperparameters section; generates the full `accelerate launch` command from current settings and copies to clipboard. No active pod required. Useful for verifying hyperparameter changes before launching.
- **Checkpoint local path no longer autofills from Forge model** — removed a `useEffect` that was incorrectly pre-populating the RunPod local model path with the Forge model identifier (a different field for a different system).
- **Download counter** — per-file status now shows `filename (1/3)` when downloading multiple files.
- **Purge failure count surfaced** — `purgeDirectory` now counts files that could not be deleted and shows a dismissible banner with the count. Previously all errors were silently swallowed.
- **Orphaned tooltip on card delete fixed** — `ImageCard` now calls `onPromptLeave` on unmount, so the prompt tooltip clears when a card is deleted while hovered.
- **Caption Editor: Save All progress bar** — a status bar appears while Save All is running, showing `Saving captions… X / Y` with a progress bar. On completion, flashes "✓ Saved N captions" for 3 seconds. Per-caption errors are now caught and reported as a count rather than silently ignored.
- **`addTagToAll` error handling** — save loop now catches per-image failures, continues the remaining images, and reports a total error count. Previously a single failure would abort the loop silently.
- **Save & Close failure surfaced** — `saveAndClose` now wraps the project save in try/catch. On failure it shows an error in the close dialog and does not close the app. Previously a failed save would leave the app in an ambiguous state.
- **Polling interval cleanup on unmount** — `RunPodLauncher` now clears all three module-level intervals (`_podPollId`, `_logPollId`, `_jupyterWaitId`) on unmount. Previously navigating away and back accumulated duplicate polling intervals.
- **Shell arg sanitisation for model filename** — `modelBaseName` is now stripped of `"`, `$`, backtick, and `\` before interpolation into the bash training command. `sanitizeShellArg()` helper added at module level; applied at all three derivation sites including `buildTrainingCommand`.

---

## [v1.0.4-alpha]

- **SDXL `--no_half_vae`** — added for SDXL training only. SDXL's VAE produces NaN corruption in fp16 mode which manifests as colour distortion baked into LoRA weights; forcing fp32 VAE during training prevents this.
- **SDXL `network_dim` default reduced 64→32** — SDXL is ~3-4× more expressive per rank unit than SD1.5, making dim=64 equivalent to dim=256 on SD1.5. Higher rank absorbs style and colour palette from training data alongside the character concept. 32 is the community consensus for SDXL character LoRAs. Store migrated to v16; existing users with dim=64 are reset to 32.
- **`mixed_precision` changed fp16→bf16** — bf16 has better dynamic range than fp16 and avoids overflow/NaN during training on modern GPUs (Ampere+). `save_precision` remains fp16.
- **`--noise_offset` reduced 0.1→0.03 for SD1.x** — 0.1 was too aggressive; 0.03 gives a mild contrast/saturation improvement without distorting darker tones. SDXL still omits noise_offset entirely.
- **`--min_snr_gamma 5` removed** — was interfering with image generation quality; removed from training command.
- **LoRA download rewrite: binary streaming** — `jupyter_download_file` now uses Jupyter's `/files/` endpoint for direct binary download instead of the base64-over-JSON `/api/contents/` API. Eliminates ~33% size overhead from base64 encoding and uses a dedicated 10-minute timeout client (was 60s via the shared login client). Confirmed working in testing.
- **`zip_dataset` content fix** — zip now only includes image files (`.png/.jpg/.jpeg/.webp`) and caption sidecars (`.txt`). Previously included the zip itself, `kohya_config.toml`, `project.json`, and any other files in the output directory.
- **Upload always re-extracts on fresh launch** — the `.extract_done` skip on the pod now only applies in reconnect mode (`skipZipUpload: true`). A fresh upload always re-uploads the zip and re-extracts, regardless of what's already on the pod.
- **Caption Editor: global Add Tag** — input + "Add to All" button in the Dataset Tags panel header adds a tag to every filtered image at once and saves all captions to disk.
- **Elapsed-time tickers** — `startTicker` helper added; all major pipeline stages now show elapsed time in the status line: packaging, zip upload, local model upload, pod startup wait, Jupyter readiness wait, and per-file LoRA download.
- **Training step progress** — tqdm lines are parsed for `step X/Y` and mirrored into the status line as "Training: step 450/2000 (22%)". Clears when training completes.
- **Pod startup user note** — a "typically takes 3–6 minutes" note is logged immediately after pod creation so users don't assume it's hung.
- **Training time message reworded** — changed from "typically takes 30–90 minutes" to "can take a long time depending on your dataset and GPU" to avoid misleading time expectations.
- **Pricing consistency** — all prices standardised to 3 decimal places with `/hr` suffix. Pre-launch GPU selector prices labelled `from $X.XXX/hr` (they reflect the global floor, not actual pod cost). Best value badge labelled `est. total` to distinguish it from a per-hour rate.
- **Polling `cancelled` flag** — each `startPolling` session now carries a `cancelled` flag; in-flight async ticks self-abort if a newer session has started, preventing duplicate error accumulation from concurrent polling instances.
- **`stopPolling` clears persisted pod ID** — `runpodActivePodId` and `runpodActiveJupyterUrl` are now cleared from the Zustand store when polling stops for any reason, so the reconnect effect doesn't re-fire on next page mount against a ghost pod.
- **Log line cleanup: strip filename/lineno suffix** — Kohya appends `\tfilename.py:lineno` to INFO log lines; these are now stripped before display.
- **Training command debug file** — `training_command.txt` saved to `outputDir` on each training run for debugging; previously had a bug where the script name was written as literal `[trainScript]`.
- **Delete error surfacing** — `delete_image` failures in the Batch Generator (card trash button and preview pane) now surface inline instead of silently passing. The store entry is only removed if the file delete succeeds. Requeue path logs failures to console rather than swallowing them.

---

## [v1.0.3-alpha]

- **SDXL noise_offset disabled** — `--noise_offset` now only applied for SD1.x training. SDXL uses a different noise schedule; applying noise_offset there causes colour desaturation and drift.
- **Download dotfile fix** — listing temp file renamed from `.output_list.txt` → `output_list.txt`. Jupyter Contents API can refuse hidden/dotfiles, causing the download to fail with a ~70x error.
- **LoRA download rewrite** — `downloadOutputs` now lists output files via the Jupyter Contents API (`jupyter_list_dir`) instead of running `ls` via a terminal command. Terminal approach was unreliable (fire-and-forget, no error surface). Also sets `downloadFailed` when no files are found so the Retry button appears.
- **Reconnect no longer restarts completed training** — `checkAndResume` now checks for `.safetensors` output files before calling `launchTraining`; if output already exists, triggers download instead of relaunch.
- **Base64 MIME decoding fix** — `jupyter_download_file` now strips whitespace from the base64 payload before decoding. Jupyter returns MIME-wrapped base64 (with newlines) which the standard decoder rejected with "Invalid byte 10".
- **Force-download button** — a "Training complete? Force-start download" bar appears in the log area while stuck at the Training step with Jupyter connected, allowing manual download trigger if auto-detection missed the completion signal.

---

## [v1.0.2-alpha]

- **Color themes** — 7 built-in themes selectable in Settings (Default Dark, Dead Tree Edition, Synthwave, Colorblind Friendly, Light Mode I Guess, Colorblind Hell, Colorblind Hell Simulated). Custom theme: JSON file of CSS variable overrides layered on top of selected built-in. Theme persisted in Zustand store.
- **Training completion detection fixed** — bash script always appends `echo "training complete"` after accelerate exits regardless of exit code; additionally appends `echo "training failed (exit N)"` only if non-zero. Previously a non-zero exit silently halted the UI.
- **Reconnect training-state detection** — on reconnect, reads `training.log` and branches correctly: "training complete" → triggers download; "training failed" → trainingHalted banner + Retry; still running → resumes log tail from last line.
- **Auto-download LoRA after training** — `downloadOutputs` runs on completion, saves to `character.outputDir`. Toggle for final-only vs final + intermediates.
- **Auto-terminate pod after download** — `terminatePod` called after `downloadOutputs` completes; skipped on error. Uses `podRef`/`apiKeyRef` to avoid stale closures. Toggle checkbox (default on).
- **Download retry button** — `downloadFailed` state shows a sticky "Retry Download" banner in the log area; pod stays alive on failure.
- **Log panel layout** — `uploadStatus` moved above log lines (always visible). Error banners (download failed, training halted) moved to sticky bottom with backdrop blur.
- **Pipeline flow indicator** — horizontal step indicator: Create pod → Upload dataset → Get checkpoint → Training → Download LoRA → Done. Steps advance and turn green automatically.
- **Retry button** — appears after training fails; calls `checkAndResume` to relaunch using files already on the pod, skipping re-upload.
- **RunPod reconnect/resume rework** — `checkAndResume` checks marker files (`.extract_done`, `.model_manifest`) before deciding what to re-upload; skips stable completed steps. Duplicate upload guard (`_uploadInProgress`) and duplicate training guard (`pgrep`) prevent double-execution on reconnect.
- **Jupyter wait extracted** — module-level `_jupyterWaitId` prevents duplicate wait intervals across HMR remounts; timeout extended 6 → 12 minutes.
- **Pod poll backoff** — after 20 consecutive `getPod` errors, switches 15s → 60s poll interval instead of spamming the log.
- **Pod poll stops on fatal training error** — OOM / `exit 1` detected in log stops both log and pod polling; shows "Training halted" banner.
- **Optimizer-aware GPU flags** — `gpuTrainingFlags` takes optimizer as parameter; Prodigy/DAdaptAdam reduce batch size one tier for their larger float32 state footprint.
- **A100 80GB batch size 4→2** — was filling up with SDXL + cache_latents; reduced to match 48GB tier. Adaptive tier 2→1.
- **Training time estimates recalibrated** — L40S confirmed at 0.4 steps/sec (was 1.8); all GPU entries and fallback tiers scaled proportionally.
- **`PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`** — added to training command to reduce CUDA memory fragmentation.
- **noise_offset bumped 0.05→0.1** — fixes washed-out outputs in SD1.x training.
- **Trigger word sanitisation hardened** — strips all non-`[a-z0-9_]` characters (was: replace spaces with `_` only), preventing shell metacharacters in pod commands.
- **`ensure_dir` keystroke bug fixed** — was accidentally triggering on keyboard input.
- **`pick_file` param fix** — corrected parameter shape for the Tauri file picker command.
- **Stale recent projects** — Load button checks `path_exists` first; shows "Not found / Remove" inline if missing.
- **LoRA dir rescan button** — Refresh button in Character Setup loraDir field; shows file count after scan.
- **`updateImage` sets `isDirty`** — close-warning fires correctly after caption tag edits.
- **CaptionEditor save errors surfaced** — error displayed below Save Caption button.
- **Keyboard navigation in Caption Editor** — left/right arrow keys navigate between images; skips when focus is in an input/textarea.
- **Random mode fix** — removed `combos.length > randomCount` guard so shuffle+slice always runs in random mode regardless of combo count.
- **Trigger word removed from generate prompt** — `character.triggerWord` removed from `buildFullPrompt` in BatchGenerator (trigger word has no meaning in the base model before the LoRA is trained).
- **Dynamic Prompts export** — Shot List page generates a Dynamic Prompts-compatible block (`{option1|option2}` syntax) for use in Forge without the API.

---

## [v1.0.1-alpha]

- **Code trim** — removed dead `read_file_b64` (duplicate of `read_image_b64`), `jupyter_run_sync` (never called), `jupyterFileExists` stub (always returned false), `configExists` unused variable.

---

## [v1.0.0-alpha]

- Initial release — full workflow: Character Setup → Shot List → Batch Generator → Caption Editor → RunPod Launcher.
- **Multi-select images** — shift-click range, ctrl-click toggle in Batch Generator for bulk approve/reject.
- **Per-image Forge progress bar** — polls `forge_get_progress` every 800ms, shows thin progress bar + % in status strip.
- **`forge_get_models` wired to model picker** — CharacterSetup uses `invoke("forge_get_models", { baseUrl })`.
