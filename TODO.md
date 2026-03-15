# LoRA Studio — TODO

## In Progress / Needs Verification

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

### RunPod Launcher — Cleanup
- [ ] **Remove force-download button** — escape hatch for broken completion detection. Once download flow is confirmed reliable, remove it.
- [ ] **Download step has no overall progress indicator** — per-file ticker added, but no "file 1 of 3" counter when downloading multiple intermediates.
- [ ] **Progress status line should be sticky/floating** — currently renders at the top of the log scroll area and scrolls off as logs accumulate. Should stay visible at the top of the log panel regardless of scroll position.

### General
- [ ] Character preset gallery — save and reload full character configs (separate from project save)
- [ ] **Fox's Automatic Braindead Character Describer (ABCD)** — potential more fun name for this app. AI-assisted tool to auto-generate core description, artist tags, and trigger word from a reference image or text prompt
- [ ] Checkpoint local directory field on RunPod tab autofills with an incorrect value

---

## Code Quality / Technical Debt

- [ ] **Silent error swallowing in purge path** — `purgeDirectory` silences all `delete_image` errors. Acceptable for sweep operations but a count of failures would be useful UX.
- [ ] **`lib.rs` module split** — at ~637 lines, `src-tauri/src/lib.rs` is past the threshold where splitting into submodules (`commands/forge.rs`, `commands/jupyter.rs`, etc.) would aid maintainability. Investigate before adding further Rust commands.

---

## Known Bugs

- [ ] **Batch Generator: orphaned tooltip on card delete** — when a card is deleted while its tooltip is visible, the tooltip remains on screen unattached. Likely needs the tooltip to be dismissed on unmount of the card component.

- [ ] Detecting readiness of jupyter and kohya containers is slow
- [ ] Occasionally initial attempt to create and load in a pod hang at the 'waiting for Jupyter to come up' message. Linking to a running instance bypasses this issue (waited 30+ mins, confirmed it was running via manually going to jupyter url)
