# LoRA Studio — TODO

## Next Session
- [ ] Test RunPod launcher end-to-end (API key → package → launch pod → monitor)
- [ ] Wet-run: generate a full character dataset and run training on RunPod

## In Progress
- [ ] Continue developing captions page (review & edit workflow)

## Planned
- [ ] Favourite / custom presets for Shot List tag panels — allow users to manage which tags appear in the preset menus per category (poses, expressions, outfits, backgrounds), replacing or supplementing the hardcoded lists. Could be stored per-character or globally in settings.

## Done This Session
- [x] Close confirmation dialog — Save & Close / Discard & Close / Cancel on window close when unsaved changes exist
- [x] UI scale slider in Settings (70–150%, applied via CSS zoom, persisted)
- [x] Font size improvements across all pages (section labels, hint text, inputs)
- [x] Auto-requeue toggle on Generate tab — rejected images immediately requeued; starts generation if none running
- [x] RunPod GraphQL proxied through Rust (fixes CORS error from webview)
- [x] RunPod GPU pricing — live fetch via Refresh Prices button, updates per Secure/Community selection
- [x] RunPod estimated training time — computed from GPU benchmarks, steps, and resolution
- [x] RunPod step suggestion based on dataset size (images × 100, bounded 500–4000)
- [x] RunPod Kohya config — network_alpha, lr_warmup_steps, save_every_n_steps now auto-calculated; removed from UI
- [x] Load saved characters — recent projects list + load from folder/archive on Character Setup

