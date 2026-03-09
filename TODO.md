# LoRA Studio — TODO

## Untested / Needs Verification
- [ ] **RunPod launcher end-to-end re-test required** — the reconnect/resume flow, Jupyter wait, duplicate-upload guards, and retry-on-failure path have all been significantly reworked since the confirmed wet-run. A full pass from pod launch through training completion and LoRA download needs to be verified again.
  - **Live-run completion**: Fixed — bash script now always writes "training complete" after accelerate exits (regardless of exit code), so the detection reliably fires even when Kohya/accelerate returns non-zero on success. Previously a non-zero exit would write "training failed" and halt the UI silently (the "training failed" line was filtered from the log panel).
  - **Reconnect-after-completion**: Fixed — reconnect now calls `downloadOutputs(runpodActiveJupyterUrl)` directly instead of just `setPhase("done")`. Auto-download now triggers on reconnect.
  - **Reconnect-before-training-starts**: if `training.log` is missing, falls through to `checkAndResume` which checks marker files and decides whether to re-upload or just relaunch training.

## Planned Features

### Shot List
- [ ] Custom/favourite presets per category — allow users to save their own presets alongside the hardcoded ones, stored per-character or globally in settings

### Batch Generator
- [ ] Auto-select "All Combos" mode by default if the user hasn't explicitly chosen a mode (i.e. new character / fresh state)
- [x] Random mode ignores `randomCount` when combos ≤ randomCount — removed the `combos.length > randomCount` guard so shuffle+slice always runs in random mode

### Caption Editor
- [ ] Import images from an existing folder — load externally sourced or manually created images into the caption workflow without going through the generator
- [x] Keyboard navigation between images (arrow keys) — left/right arrows, skips when focus is in an input/textarea

### UX Pattern: Live Status Mirror
- [ ] Anywhere there's a log panel monitoring an ongoing process, show a persistent "currently doing X" status line above the log (see `uploadStatus` in RunPodLauncher — updates to reflect current step with elapsed time e.g. `Extracting dataset… (10s)`). Candidates: Batch Generator progress label, Caption Editor save-all feedback.

### RunPod Launcher — Documentation / UX Notes
- [ ] **Pod startup is very slow — needs a user-facing note**: From "Launch" to "Jupyter ready" typically takes 3–6 minutes (Docker pull, container init, Python env). Users should be warned to be patient and not assume it's broken. Add to README or as an inline note in the UI near the "Waiting for pod to start" phase.

### RunPod Launcher — Status Feedback Gaps
`uploadStatus` is the right pattern but only covers part of the timeline. Apply it consistently:
- [ ] **Packaging**: Start elapsed-time ticker when zip starts (`setPhase("packaging")`), show in `uploadStatus`
- [ ] **Zip upload / model local upload**: Elapsed-time ticker (Jupyter API doesn't expose byte progress)
- [ ] **Pod startup wait**: Set `uploadStatus` with elapsed time in the pod-polling loop (currently only logged)
- [ ] **Jupyter readiness wait**: Same — elapsed time in `uploadStatus` while waiting for `/api/terminals`
- [ ] **Model download on pod**: After firing nohup, keep a time ticker running ("Downloading model on pod… (2m 30s) — check Jupyter for progress")
- [ ] **Training**: Parse step info from Kohya log lines and mirror into `uploadStatus` as a persistent "Training: step 450/2000 (22%)" line above the log

### General
- [ ] Character preset gallery — save and reload full character configs (separate from project save), useful for switching between characters quickly
- [x] Prompting inserts the training keyword into the generate prompt pointlessly — removed `character.triggerWord` from `buildFullPrompt` in BatchGenerator (trigger word has no meaning in the base model before the LoRA is trained)
- [ ] **Fox's Automatic Braindead Character Describer (ABCD)** — AI-assisted tool to auto-generate the core description, artist tags, and trigger word from a reference image or text prompt
- [ ] checkpoint local directory field on runpod tab autofills with an incorrect value
- [ ] pricing on Runpod launcher page are inconsistent. Best value, price per hour, reported price on pod status marker, and price reported in the log don't match each other

---

## ~~Planned Tool: Dynamic Prompts Export~~ ✓ Done

**Goal:** Convert the current shot list into a [Dynamic Prompts](https://github.com/adieyal/sd-dynamic-prompts) compatible block that can be copied and pasted directly into Forge's positive prompt field — no API required.

**Dynamic Prompts syntax:**
- `{option1|option2|option3}` — picks one at random each generation
- `{2$$option1|option2|option3}` — picks 2
- `__wildcard__` — references a wildcard file

**Output format (example):**
```
mycharacter, wolf girl, long silver hair, style of artist1, {standing, full body|sitting|kneeling, looking over shoulder}, {neutral expression|smiling, looking at viewer|serious expression}, {casual outfit, jeans, t-shirt|sundress}, {simple background, white background|outdoors, forest background}
```

**Implementation plan:**
1. Add a "Dynamic Prompts" button/panel at the bottom of the Shot List page, below the Prompt Preview
2. `buildDynamicPromptsBlock(character, generation)` in `src/lib/forge.ts`:
   - Fixed prefix: `[triggerWord, species, baseDescription, "style of " + artistTags]` joined with `, `
   - Per-category group: if category has >1 variant → `{v1|v2|v3}`, if exactly 1 → emit as plain text, if 0 → omit
   - Outfits: include triggerWord prefix per entry if set — `{outfitTrigger, outfitPrompt|...}`
   - LoRAs (global + per-pose/outfit) are excluded from the block (they are Forge syntax, not Dynamic Prompts)
   - Extras appended as plain text after the groups
3. UI: collapsible panel with a read-only `<textarea>` showing the block and a "Copy" button
4. Show a note: "This generates one random combination per image — not the full cartesian product"

**Edge cases to handle:**
- Single-variant categories should not be wrapped in `{}` (no-op variation)
- Empty category fields should not produce empty group slots
- Use `.filter((s) => s && s.trim())` throughout (existing pattern)
- Outfit entries with a `triggerWord` should prepend it inside the `{}` group

---

## Known Issues (pre-v1.0)

- [ ] **RunPod Launcher loses pod connection on navigation** — pod/Jupyter URL survive navigation (lifted into Zustand in-memory store), but local React state (zip path, pipeline step, etc.) resets on remount. The reconnect path handles most cases but hasn't been fully tested post-refactor.

---

## Done

- [x] **Color themes / palette swaps** — 7 built-in themes selectable in Settings, plus a custom JSON theme file for CSS variable overrides. Theme picker in Settings, selection persisted in Zustand store.
- [x] **Multi-select images for bulk approve/reject** — shift-click range, ctrl-click toggle in Batch Generator.
- [x] **Per-image Forge step progress bar** — polls `forge_get_progress` every 800ms during each image, shows thin progress bar + % in status strip.
- [x] **`forge_get_models` wired to model picker** — CharacterSetup uses `invoke("forge_get_models", { baseUrl })`.
- [x] **Auto-terminate pod after successful download** — `terminatePod` called after `downloadOutputs` completes without error; skipped on error. Uses `podRef`/`apiKeyRef` to avoid stale closures. Toggle checkbox in UI (default on).
- [x] **Training time estimates recalibrated** — L40S confirmed at 0.4 steps/sec (was 1.8); all GPU entries and fallback tiers scaled proportionally.
- [x] **`updateImage` sets `isDirty`** — close-warning now fires correctly after caption tag edits.
- [x] **CaptionEditor save errors surfaced** — error displayed below Save Caption button.
- [x] **Stale recent projects** — Load button checks `path_exists` first; shows "Not found / Remove" inline if missing.
- [x] **LoRA dir rescan button** — Refresh button added to the loraDir field in Character Setup; shows file count after scan.
- [x] **RunPod reconnect/resume rework** — `checkAndResume` checks marker files (`.extract_done`, `.model_manifest`) before deciding what to re-upload; skips stable completed steps. Falls back to `startJupyterWait` if Jupyter isn't up yet. Duplicate upload guard (`_uploadInProgress`) and duplicate training guard (`pgrep`) prevent double-execution on reconnect.
- [x] **Jupyter wait extracted to `startJupyterWait`** — module-level `_jupyterWaitId` prevents duplicate wait intervals across HMR remounts; timeout extended from 6 to 12 minutes.
- [x] **Pod poll backoff on API failures** — after 20 consecutive `getPod` errors, switches from 15s to 60s poll interval instead of resetting and spamming the log every 5 minutes.
- [x] **Pod poll stops on fatal training error** — when `exit 1` / OOM is detected in the training log, both log and pod polling stop; UI shows "Training halted" banner with a Retry button.
- [x] **Retry button** — appears in the log area after training fails; calls `checkAndResume` to relaunch training using files already on the pod, skipping re-upload.
- [x] **Pipeline flow indicator** — horizontal step indicator at top of RunPod Launcher shows Create pod → Upload dataset → Get checkpoint → Training → Download LoRA → Done; steps advance automatically and turn green on completion.
- [x] **Optimizer-aware GPU flags** — `gpuTrainingFlags` now takes optimizer as a parameter; Prodigy and DAdaptAdam reduce batch size one tier to account for their larger float32 optimizer state footprint.
- [x] **`PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`** — added to training command to reduce CUDA memory fragmentation.
- [x] **Trigger word sanitisation hardened** — input now strips all non-`[a-z0-9_]` characters (was: replace spaces with `_` only), preventing accidental shell metacharacters in pod commands.
- [x] **Reconnect training-state detection** — on reconnect, reads `training.log` and correctly branches: "training complete" → phase done + "ready to download" message; "training failed" → trainingHalted banner + Retry button; still-running → resumes log tail from end. Previously all non-empty logs just resumed polling, masking already-completed runs.
- [x] **A100 80GB batch size reduced 4→2** — non-adaptive optimizers were previously using batch 4 on 80 GB VRAM, which fills up with SDXL + cache_latents. Reduced to 2 (matching 48 GB tier) for OOM safety. Adaptive tier also adjusted 2→1.
- [x] **Log panel layout: status above log, banners sticky below** — `uploadStatus` spinner/message moved to the top of the log area (above log lines) so it's always visible during active phases. Error banners (download failed, training halted) moved to the bottom as sticky elements with backdrop blur so they don't obscure earlier log lines.
