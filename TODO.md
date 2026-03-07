# LoRA Studio — TODO

## Untested / Needs Verification
- [ ] Test RunPod launcher end-to-end (API key → package → launch pod → monitor)
- [ ] Wet-run: generate a full character dataset and run training on RunPod
- [ ] Verify `forge_get_models` is wired to model picker in CharacterSetup (command exists in Rust, UI status unclear)

## Planned Features

### Shot List
- [ ] Custom/favourite presets per category — allow users to save their own presets alongside the hardcoded ones, stored per-character or globally in settings

### Batch Generator
- [ ] Multi-select images for bulk approve/reject (shift-click range, ctrl-click toggle)
- [ ] Per-image Forge step progress bar — `forge_get_progress` already exists in Rust but is not polled during generation; could show a live step indicator on the active card

### Caption Editor
- [ ] Import images from an existing folder — load externally sourced or manually created images into the caption workflow without going through the generator
- [ ] Keyboard navigation between images (arrow keys)

### General
- [ ] Character preset gallery — save and reload full character configs (separate from project save), useful for switching between characters quickly
- [ ] **Fox's Automatic Braindead Character Describer (ABCD)** — AI-assisted tool to auto-generate the core description, artist tags, and trigger word from a reference image or text prompt

---

## Planned Tool: Dynamic Prompts Export

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

## Done

- [x] Close confirmation dialog — Save & Close / Discard & Close / Cancel on window close when unsaved changes exist
- [x] UI scale slider in Settings (70–150%, applied via CSS zoom, persisted)
- [x] Font size improvements across all pages (section labels, hint text, inputs)
- [x] Auto-requeue toggle on Generate tab — rejected images immediately requeued; starts generation if none running
- [x] RunPod GraphQL proxied through Rust (fixes CORS error from webview)
- [x] RunPod GPU pricing — live fetch via Refresh Prices button, updates per Secure/Community selection
- [x] RunPod estimated training time — computed from GPU benchmarks, steps, and resolution
- [x] RunPod step suggestion based on dataset size (images × 100, bounded 500–4000)
- [x] RunPod Kohya config — network_alpha, lr_warmup_steps, save_every_n_epochs now auto-calculated; removed from UI
- [x] Load saved characters — recent projects list + load from folder/archive on Character Setup
- [x] Caption Editor — filter bar (approved/pending/all), per-image tag chips, add/remove tags, raw textarea edit, dataset-wide tag panel with bulk disable + Save All
- [x] Batch Generator requeue — old file deleted only after replacement succeeds
- [x] Batch Generator purge — sweeps output directory for orphaned files not in store
- [x] Prompt preview on Shot List (combo 1 of N)
- [x] Per-pose and per-outfit LoRA attachment
- [x] Species field in prompt builder
- [x] Lightbox + prompt tooltip on image cards
- [x] Positive/negative embedding chip inputs
