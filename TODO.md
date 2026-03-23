# LoRA Studio — TODO

## In Progress / Needs Verification

- [ ] **RunPod Launcher loses pod connection on navigation** — pod/Jupyter URL survive navigation (lifted into Zustand in-memory store), but local React state (zip path, pipeline step, etc.) resets on remount. The reconnect path handles most cases but hasn't been fully tested post-refactor.

---

## Planned Features

### Shot List
- [ ] Custom/favourite presets per category — allow users to save their own presets alongside the hardcoded ones, stored per-character or globally in settings

### Batch Generator
- [ ] Auto-select "All Combos" mode by default if the user hasn't explicitly chosen a mode (i.e. new character / fresh state)
- [ ] **Selective purge** — option to discard only unapproved images (pending + rejected), leaving approved images untouched. Complement to the existing full purge.

### Caption Editor
- [ ] Import images from an existing folder — load externally sourced or manually created images into the caption workflow without going through the generator


### RunPod Launcher — Cleanup
- [ ] **Remove force-download button** — escape hatch for broken completion detection. Once download flow is confirmed reliable, remove it.

### General
- [ ] **Custom app icon** — currently shows the default Tauri gear on Linux. Steps: create a 1024×1024 source PNG, run `npm run tauri icon ./icon.png` to regenerate all sizes, then add `icons/256x256.png` and `icons/icon.png` (512px) to the `bundle.icon` array in `tauri.conf.json` so Linux desktop environments get a high-res version.

- [ ] Character preset gallery — save and reload full character configs (separate from project save)
- [ ] **Fox's Automatic Braindead Character Describer (ABCD)** — potential more fun name for this app. AI-assisted tool to auto-generate core description, artist tags, and trigger word from a reference image or text prompt

---

## Code Quality / Technical Debt

- [ ] **`lib.rs` module split** — at ~637 lines, `src-tauri/src/lib.rs` is past the threshold where splitting into submodules (`commands/forge.rs`, `commands/jupyter.rs`, etc.) would aid maintainability. Investigate before adding further Rust commands.
- [ ] **Migration order: v4/v5 swapped in source** (`store.ts`) — v5 block appears before v4 block. Both are guarded by `if (version === N)` so it works, but the order is misleading and a trap for future migrations. Reorder to match version sequence.

---

## Known Bugs

- [ ] Detecting readiness of jupyter and kohya containers is slow
- [ ] Occasionally initial attempt to create and load in a pod hang at the 'waiting for Jupyter to come up' message. Linking to a running instance bypasses this issue (waited 30+ mins, confirmed it was running via manually going to jupyter url)
- [ ] **Training log still embeds `train_util.py` line numbers** — the log strip that removes `\tfilename.py:lineno` suffixes from Kohya INFO lines doesn't catch all cases; `train_util.py` line references still appear in the remote pod log output. Needs broader stripping or a regex that covers multi-file patterns.

---

## Audit Findings

### Medium — logic bug or bad UX

- [ ] **`buildTrainingCommand` derives model name differently to `launchTraining`** (`RunPodLauncher.tsx`) — copy button uses `config.baseModelLocalPath || config.baseModelDownloadUrl`; actual launch derives from `character.baseModel` with bracket-stripping. Preview can show a different model name to what gets used.
- [ ] **No width/height validation before generation** (`BatchGenerator.tsx`) — `generation.width`/`height` passed straight to Forge. If `parseInt` returns 0 on bad input in GeneratorSettings, Forge returns a cryptic error with no pre-validation UI feedback.
- [ ] **Misleading download log message** (`RunPodLauncher.tsx`) — `Found ${files.length} file(s), downloading ${toDownload.length}` — `files.length` includes intermediates even when filtering them out, so it can say "Found 5 files, downloading 1" with no explanation.
- [ ] **`purgeAndGenerate` ignores `purgeDirectory` failure count** (`BatchGenerator.tsx`) — `purgeDirectory` now returns a failure count but `purgeAndGenerate` discards the result. Should surface failures the same way `purgeAll` does.
- [ ] **No upper bound on cartesian product** (`BatchGenerator.tsx`) — 100 poses × 100 outfits × 10 expressions × 10 backgrounds = 1,000,000 queue items. No warning or cap. Add a pre-generate count check with a confirmation prompt above a sensible threshold.

### Low — minor inconsistency

- [ ] **`base64ToBytes` doesn't catch `atob()` exceptions** (`forge.ts`) — malformed Forge response throws uncaught exception. Wrap in try/catch and surface the error at the call site.
