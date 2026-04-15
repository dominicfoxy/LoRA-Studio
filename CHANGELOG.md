# LoRA Studio — Changelog

## [Unreleased]

---

## [v1.1.1-alpha]

- **Split `lib/runpod.ts` into submodules** — broke the 282-line monolithic `runpod.ts` into `lib/runpod/types.ts` (interfaces), `api.ts` (GraphQL + runpodctl wrappers), `ssh.ts` (SSH invoke wrappers), `gpu.ts` (compatibility/throughput/training flags), `kohya.ts` (pod template + dataset config generation), and `index.ts` (barrel re-export). `RunPodLauncher.tsx` imports unchanged — barrel preserves all public API. `SearchResult` interface moved from component-local to `types.ts`.
- **Comprehensive refactor audit** — deep-interviewed requirements, then audited the full codebase for AI-generated assumptions that were never re-evaluated as scope changed. Added 25 findings to TODO.md organized by impact tier (Critical → Minor), each with a concrete fix plan.
- **Fix: remove dead fetch-to-localhost code from forge.ts** — removed `txt2img()`, `getProgress()`, `getModels()`, `setModel()`, `interruptGeneration()` and their interfaces (`Txt2ImgParams`, `Txt2ImgResponse`). These used `fetch()` to localhost which is blocked in Tauri's webview. None were called — all pages correctly use `invoke()` to the Rust backend. Only utility functions remain (`normSeg`, `base64ToBytes`, `deriveCaption`, `buildDynamicPromptsBlock`).
- **Fix: move module-level timer state to useRef in RunPodLauncher** — `_podPollId`, `_logPollId`, `_sshWaitId`, `_uploadInProgress`, `_connectedPodId` were module-scope `let` variables that could leak timers and stale state across navigations. Now stored in `useRef` hooks, governed by React lifecycle and cleaned up on unmount.
- **Fix: replace 200-line store migration cascade with deep-merge** — the 23-version `if (version === N)` chain plus ~50 lines of "ensure X present" guards is replaced by: legacy structural transforms (v0–v20 for data shape changes like shots→generation, string[]→PoseEntry[], learningRate split) followed by a single deep-merge pass that spreads current defaults under persisted values. New fields now automatically get defaults — no migration code needed.

- **Theme file portability note** — custom theme file hint in Settings now mentions that theme JSON files are portable across all apps using the same design system.
- **Editable favourite presets on Shot List** — replaced hardcoded preset arrays with user-editable favourites per category (poses, outfits, expressions, backgrounds). Favourites are always visible as chips below each category, persist across sessions, and ship with descriptive multi-tag defaults for EZ Mode users. Star icon on each variant row saves/unsaves to favourites. `+ favourite` button adds custom entries inline.
- **Split `lib.rs` into submodules** — broke the monolithic 624-line `lib.rs` into `commands/forge.rs`, `commands/files.rs`, `commands/runpod.rs`, and `commands/pickers.rs`. `lib.rs` now just holds `expand_tilde()`, `close_app`, and the Tauri builder. Removed unused `ImageEntry` struct.
- **Reduce Claude Code token usage** — split global `~/.claude/CLAUDE.md` (538 lines) into a lean 71-line core + `~/.claude/design-baseline.md` (484 lines, loaded on demand for UI work only). Trimmed project MEMORY.md from 110 to 25 lines by removing code-derivable content and moving RunPod gotchas to a separate file. Moved cross-project feedback rules to global `~/.claude/memory/`.
