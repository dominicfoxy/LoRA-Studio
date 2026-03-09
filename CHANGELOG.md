# LoRA Studio — Changelog

## [Unreleased] — next push

- **SDXL noise_offset disabled** — `--noise_offset 0.1` now only applied for SD1.x training. SDXL uses a different noise schedule; applying noise_offset there causes colour desaturation and drift. SDXL training omits the flag entirely.
- **Download dotfile fix** — listing temp file renamed from `.output_list.txt` → `output_list.txt`. Jupyter Contents API can refuse hidden/dotfiles, causing the download to fail with a ~70x error.

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
