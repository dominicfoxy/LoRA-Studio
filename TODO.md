# LoRA Studio — TODO

## In Progress / Needs Verification

- [ ] **RunPod end-to-end wet-run** — download dotfile fix and SDXL noise_offset fix are untested in a real run. Need to confirm: file listing, download, auto-terminate all complete cleanly.
- [ ] **RunPod Launcher loses pod connection on navigation** — pod/Jupyter URL survive navigation (lifted into Zustand in-memory store), but local React state (zip path, pipeline step, etc.) resets on remount. The reconnect path handles most cases but hasn't been fully tested post-refactor.

---

## Planned Features

### Shot List
- [ ] Custom/favourite presets per category — allow users to save their own presets alongside the hardcoded ones, stored per-character or globally in settings

### Batch Generator
- [ ] Auto-select "All Combos" mode by default if the user hasn't explicitly chosen a mode (i.e. new character / fresh state)

### Caption Editor
- [ ] Import images from an existing folder — load externally sourced or manually created images into the caption workflow without going through the generator

### UX Pattern: Live Status Mirror
- [ ] Anywhere there's a log panel monitoring an ongoing process, show a persistent "currently doing X" status line above the log (see `uploadStatus` in RunPodLauncher). Candidates: Batch Generator progress label, Caption Editor save-all feedback.

### RunPod Launcher — Documentation / UX Notes
- [ ] **Pod startup slow — needs user-facing note**: From "Launch" to "Jupyter ready" typically takes 3–6 minutes. Add an inline note near the "Waiting for pod to start" phase so users don't assume it's broken.

### RunPod Launcher — Status Feedback Gaps
`uploadStatus` is the right pattern but only covers part of the timeline. Apply consistently:
- [ ] **Packaging**: elapsed-time ticker when zip starts
- [ ] **Zip upload / model local upload**: elapsed-time ticker (Jupyter API doesn't expose byte progress)
- [ ] **Pod startup wait**: elapsed time in `uploadStatus` while pod-polling (currently only logged)
- [ ] **Jupyter readiness wait**: elapsed time in `uploadStatus` while waiting for `/api/terminals`
- [ ] **Model download on pod**: time ticker after firing nohup ("Downloading model on pod… (2m 30s)")
- [ ] **Training**: parse step info from Kohya log and mirror into `uploadStatus` ("Training: step 450/2000 (22%)")

### General
- [ ] Character preset gallery — save and reload full character configs (separate from project save)
- [ ] **Fox's Automatic Braindead Character Describer (ABCD)** — AI-assisted tool to auto-generate core description, artist tags, and trigger word from a reference image or text prompt
- [ ] Checkpoint local directory field on RunPod tab autofills with an incorrect value
- [ ] Pricing on RunPod launcher page is inconsistent — Best value, price per hour, pod status marker price, and log price don't match each other

---

## Known Bugs

_(none currently logged)_
