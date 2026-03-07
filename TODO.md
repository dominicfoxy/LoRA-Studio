# LoRA Studio — TODO

## Untested / Needs Verification
- [~] Test RunPod launcher end-to-end (API key → package → launch pod → monitor) — **in progress**, upload/extract/launch working; dataset path issue being debugged
- [~] Wet-run: generate a full character dataset and run training on RunPod — **in progress**, blocked on dataset `image_dir` not being found by train_network.py
- [x] Verify `forge_get_models` is wired to model picker in CharacterSetup — confirmed, uses `invoke("forge_get_models", { baseUrl })`

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

## Known Issues (pre-v1.0)

- [ ] **RunPod Launcher loses pod connection on navigation** — all pod state (pod ID, Jupyter URL, polling interval, logs) is local React state and is destroyed when the user navigates away from the page. Intentionally left as-is for now since it makes debugging easier. Fix before v1.0: lift pod/polling state into the Zustand store so it survives page changes.

---

## Done

Cleared — see git log for completed items.
