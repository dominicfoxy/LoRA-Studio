# LoRA Studio — TODO

## Bugs

### Medium
- [x] **"Waiting for pod to start" ticker sticks after pod is already running** — `stopPodTicker()` is called unconditionally at line 1010 whenever pod reaches RUNNING, regardless of path. Confirmed fixed for both fresh launch and `linkPod`.
- [x] **`buildTrainingCommand` shows wrong model name** — fixed; preview now uses `character.baseModel` matching the actual launch path.
- [x] **No width/height validation before generation** — fixed; validates non-zero and divisible by 8 before queuing, surfaces via `lastError`.
- [x] **Misleading download log message** — fixed; now shows `skipping N intermediate(s)` when intermediates are filtered, so the counts make sense.
- [x] **`purgeAndGenerate` ignores purge failure count** — fixed; failure count now surfaced via `setPurgeFailCount` same as `purgeAll`.
- [x] **No upper bound on cartesian product** — fixed; queues over 50 images show a confirmation banner before proceeding.
- [x] **Detecting readiness of Jupyter and Kohya containers is slow** — fixed; probe now uses single GET /login with 8s timeout, first check fires immediately, interval reduced to 5s.
- [x] **Occasionally hangs at "waiting for Jupyter to come up"** — fixed; was caused by 60s-timeout login requests piling up across 15s interval ticks. Overlap guard + short timeout prevents this.
- [x] **Training log still embeds `train_util.py` line numbers** — fixed; now strips leading timestamp + `LEVEL     file.py:N: ` prefix in addition to trailing `\tfile.py:N`.
- [x] **Pin Kohya docker image to a specific tag** — default and `KOHYA_POD_TEMPLATE` both updated to `ashleykza/kohya:25.2.1`; v20→21 migration pins any existing `:latest` user to the same tag. Note: image was `ashleykza/kohya-ss` (old name, no longer exists) — corrected to `ashleykza/kohya`.

### Low
- [x] **`base64ToBytes` doesn't catch `atob()` exceptions** (`forge.ts`) — wrapped in try/catch; throws a clear "Forge returned an invalid image" message that propagates to the generation error banner.

---

## Planned Features

### Shot List
- [ ] Custom/favourite presets per category — save user presets alongside hardcoded ones, stored per-character or globally

### Batch Generator
- [ ] Auto-select "All Combos" mode by default for a new character / fresh state
- [ ] **Selective purge** — discard only unapproved images (pending + rejected), leaving approved untouched

### Caption Editor
- [ ] Import images from an existing folder — load external or manually created images into the caption workflow

### RunPod Launcher
- [ ] **Filter incompatible GPUs from the selector** — the live GPU list from RunPod includes GPUs whose drivers are incompatible with the Kohya container (`ashleykza/kohya-ss:latest`), including some higher-end devices — so a minimum compute capability threshold isn't sufficient. A tested allowlist is probably the right approach. Incompatible GPUs should be hidden or shown with a warning rather than silently failing mid-training.
- [ ] **Training time estimate is inaccurate** — displayed estimate doesn't reflect real processing time. Needs profiling against actual runs to recalibrate steps/sec per GPU tier. Current values in `RECOMMENDED_GPUS` (`runpod.ts`) were last updated for L40S at 0.4 steps/sec; other GPUs scaled proportionally rather than measured.
- [ ] **Remove force-download button** — escape hatch for broken completion detection. Remove once reconnect flow is confirmed reliable across a few real runs.
- [x] **"Sensible defaults" button in Training Hyperparameters** — implemented; uses `images × 60` (SDXL, clamp 1500–3000) or `images × 40` (SD1.5, clamp 1000–2000). Step suggestion hint updated to match. — one-click auto-populate for the RunPod Launcher page only. Scope is intentionally per-page so it can't clobber settings on other tabs. Should set optimizer, LRs, dim, alpha, steps (scaled to approved image count), noise offset, min SNR gamma, and v-prediction appropriately for the selected model type (SDXL vs SD1.5). Other pages get their own equivalent buttons if/when needed.

### General / Future
- [ ] **Localisation (i18n)** — all strings are currently hardcoded in English. Defer until there is concrete demand from a non-English community. When the time comes: extract strings to a translation file (react-i18next or similar), seed with English, open PRs for community translations. The SD/LoRA audience is largely English-comfortable so this is low priority pre-launch.
- [ ] Character preset gallery — save and reload full character configs (separate from project save)
- [ ] **Optional built-in inference backend** — opt-in download of a local Forge/A1111 instance. Settings radio: External (current URL field) vs Built-in (download on first use, auto-spawn/stop via Tauri). Generation invoke commands unchanged.
- [ ] **ComfyUI backend support** — alternative to Forge. Needs workflow JSON builder, LoRA prompt tags → `LoraLoader` nodes, 3 new Rust commands, and `backendType` setting routing in BatchGenerator. ~1 week effort. Natural fit with built-in backend since ComfyUI is lighter than Forge.

---

## EZ Mode (formerly Guided Mode)

> **Largely complete** — toggle, RunPodLauncher, GeneratorSettings, ShotList, BatchGenerator locking all implemented. Hover tooltips on locked fields done. Simplified log view (step progress block) done. Embedding auto-populate deferred — spec unclear without knowing which model files the user has installed.

A beginner-facing mode where all technical decisions are automated. Creative/artistic fields stay fully interactive; technical fields are locked (disabled + dimmed) with an `auto` badge showing the computed value — visible so users can learn what each setting does.

Toggle lives in Settings and the sidebar. A subtle banner appears on technical pages when active: *"Guided mode on — settings are auto-managed."*

### Design principles
- Don't hide, dim. A curious beginner should be able to see `Network Dim: 32 (auto)` and Google it.
- Each locked field should show a hover tooltip: *"Auto: 32 — based on SDXL. Disable Guided Mode to edit."*
- The "sensible defaults" buttons (per-page) use the same auto-calc logic — implement those first and call them from guided mode's per-page init.
- Consider a simplified log view in RunPod Launcher that shows only `Step 450 / 1500 · ETA 18 min` instead of raw Kohya tqdm output.
- BatchGenerator queue-management controls (thumbnail slider, mode, requeue, purge) may be better hidden entirely rather than dimmed — dimming implies "this matters", which isn't right for e.g. thumbnail size.

### Per-page behaviour

**GeneratorSettings** — entire page locked. Steps/CFG/sampler/scheduler auto from model type (SDXL: DPM++ 2M / Karras / 20 steps / CFG 7; SD1.5: same with CFG 7).

**ShotList** — creative fields untouched. Width/height/count auto from model type; embeddings auto-populated from model type; LoRA weights locked at 0.8; dynamic prompts export hidden.

**BatchGenerator** — approve/reject fully live. Thumbnail slider, generation mode, requeue, purge buttons locked with safe defaults (auto-requeue on, mode = all).

**RunPodLauncher** — biggest win. GPU auto-selected (best value from available), cloud type auto (Community), all hyperparameters auto from SDXL flag + image count. Network volume + model selection still live (user still picks those). Log panel unchanged (or simplified — see above).

**CaptionEditor / CharacterSetup / SettingsPage** — largely untouched; already mostly artistic or required setup.

---

## Pre-Launch Checklist

- [x] **Read RunPod's API ToS** — confirmed; programmatic pod creation via the GraphQL API is permitted for third-party apps
- [x] **Add "not affiliated with" disclaimer** — added to README and to About section at bottom of Settings page
- [x] **Add a LICENSE file** — PolyForm Noncommercial 1.0.0, added to repo root
- [x] **Add brief ToS / disclaimer** — "provided as-is, you are responsible for generated content and model use" added to README and Settings About section

---

## Code Quality / Technical Debt

- [ ] **`lib.rs` module split** — at ~637 lines, worth splitting into submodules (`commands/forge.rs`, `commands/jupyter.rs`, etc.) before adding more Rust commands.
- [ ] **Migration order: v4/v5 swapped in source** (`store.ts`) — v5 block appears before v4. Works correctly but misleading; reorder to match version sequence.
