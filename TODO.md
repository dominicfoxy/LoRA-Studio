# LoRA Studio — TODO

## Bugs

### Medium
- [ ] **Training time estimate is inaccurate** — displayed estimate doesn't reflect real processing time. Needs profiling against actual runs to recalibrate steps/sec per GPU tier. Current values in `RECOMMENDED_GPUS` (`runpod.ts`) were last updated for L40S at 0.4 steps/sec; other GPUs scaled proportionally rather than measured.

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
- [ ] **Remove force-download button** — escape hatch for broken completion detection. Remove once reconnect flow is confirmed reliable across a few real runs.

### Cross-App / Ecosystem
- [ ] **Shared theme files** — all apps use the same CSS variable theme format (`{ "--accent": "#...", ... }`). Any app's theme JSON file can be loaded into any other app's custom theme field. Document this clearly in each app's Settings page so users know their themes are portable.

### General / Future
- [ ] **Localisation (i18n)** — all strings are currently hardcoded in English. Defer until there is concrete demand from a non-English community.
- [ ] Character preset gallery — save and reload full character configs (separate from project save)
- [ ] **Optional built-in inference backend** — opt-in download of a local Forge/A1111 instance
- [ ] **ComfyUI backend support** — alternative to Forge. Needs workflow JSON builder, LoRA prompt tags → `LoraLoader` nodes, 3 new Rust commands, and `backendType` setting routing in BatchGenerator.

---

## Code Quality / Technical Debt

- [ ] **`lib.rs` module split** — at ~450 lines after Jupyter removal, still worth splitting into submodules (`commands/forge.rs`, `commands/runpod.rs`, etc.) before adding more Rust commands.
- [ ] **Verify runpodctl GPU ID format vs RECOMMENDED_GPUS** — GPU IDs returned by `runpodctl gpu list` may differ in format from the strings in `RECOMMENDED_GPUS`. Needs a live test run to confirm or add a mapping table in `runpod.ts`.
