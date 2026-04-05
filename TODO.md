# LoRA Studio — TODO

## Bugs

### Medium
- [ ] **Training time estimate is approximate** — `stepsPerSecForVram()` infers throughput from VRAM tier (L40S 48GB confirmed at ~0.4 steps/sec, others scaled). Needs profiling against more GPU types to improve accuracy.

---

## Planned Features

### Shot List
- [ ] Custom/favourite presets per category — save user presets alongside hardcoded ones, stored per-character or globally

### Batch Generator
- [ ] Auto-select "All Combos" mode by default for a new character / fresh state

### Caption Editor
- [ ] Import images from an existing folder — load external or manually created images into the caption workflow

### RunPod Launcher

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
