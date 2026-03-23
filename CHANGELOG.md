# LoRA Studio — Changelog

## [v1.0.5a-alpha]

- **Link pod now runs `checkAndResume` instead of re-uploading** — the "Link" button on detected running pods was routing through `startJupyterWait` → `uploadToVolume`, ignoring `.extract_done` / `.model_manifest` and always re-uploading the dataset and config. It now calls `checkAndResume` once Jupyter is ready, matching the reconnect path.
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
