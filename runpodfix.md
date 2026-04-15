# RunPodLauncher Refactor Plan

`RunPodLauncher.tsx` is 2267 lines — one component with ~60 state variables, ~15 refs, and interleaved business logic + UI. This plan breaks it apart in stages, each independently shippable (build passes after each step).

---

## Stage 1: Extract training command builder ✅ (partially done)
**Files:** `src/lib/runpod/kohya.ts`

`buildTrainingCommand()` (lines 564–616) and `launchTraining()` (lines 618–695) both duplicate the same training args assembly. Extract a shared `buildTrainingArgs()` function into `kohya.ts` that both can call.

**Risk:** Low — pure function, no state dependencies.

---

## Stage 2: Extract model search into a custom hook
**Files:** `src/hooks/useModelSearch.ts`

State: `modelQuery`, `modelResults`, `modelLoading`, `modelOpen`, `modelSelected`, `modelDropdownRef`
Functions: `searchModels()`, `selectModel()`

This is a self-contained feature — fetches from CivitAI + HuggingFace, manages dropdown state. The hook returns state + handlers, the component just renders.

**Risk:** Low — isolated state, no cross-dependencies with pod lifecycle.

---

## Stage 3: Extract pod lifecycle into a custom hook
**Files:** `src/hooks/useRunpodSession.ts`

State: `phase`, `pipelineStep`, `pod`, `polling`, `sshHost`, `sshPort`, `activePods`, `terminating`, `trainingHalted`, `downloadFailed`, `uploadStatus`
Refs: `podRef`, `sshHostRef`, `podPollIdRef`, `logPollIdRef`, `sshWaitIdRef`, `uploadInProgressRef`, `connectedPodIdRef`, `effectiveVolumeIdRef`, `linkedPodRef`, `podUptimeRef`, `uptimeIntervalRef`
Functions: `startPolling()`, `startSshWait()`, `startLogPolling()`, `checkAndResume()`, `uploadToVolume()`, `launchTraining()`, `downloadOutputs()`, `terminateCurrentPod()`, `linkPod()`, `refreshPods()`, `launchPod()`

This is the hardest extraction — it's the core state machine. The hook takes `{ character, config, settings, images, log }` as inputs and returns all pod state + actions.

**Risk:** Medium — lots of cross-references between functions. Extract as-is first, refine later.

---

## Stage 4: Extract setup panel into a component
**Files:** `src/components/runpod/SetupPanel.tsx`

The "Setup" box (runpodctl install + SSH key registration, lines ~1332–1399) is self-contained UI with its own local state (`runpodctlStatus`, `sshKeyState`).

**Risk:** Low — minimal props needed.

---

## Stage 5: Extract config sidebar into a component
**Files:** `src/components/runpod/ConfigSidebar.tsx`

The entire left panel (lines ~1322–2018): dataset summary, network volume picker, GPU selector, cloud type toggle, hyperparameter grid, model search, action buttons.

Takes: `config`, `setConfig`, `settings`, `character`, `approved`, pod lifecycle actions
Renders: the full config UI

**Risk:** Low — it's pure presentation + config writes. Depends on Stage 2 (model search hook) and Stage 4 (setup panel) being done first so they're already extracted.

---

## Stage 6: Extract log terminal into a component
**Files:** `src/components/runpod/LogTerminal.tsx`

The right panel log viewer (lines ~2114–2256): log lines with color coding, auto-scroll, copy/clear buttons, EZ mode progress view, download-failed/training-halted action bars.

Takes: `logs`, `uploadStatus`, `phase`, `pipelineStep`, `trainingHalted`, `downloadFailed`, `sshHost`/`sshPort`, retry callbacks
Renders: the terminal UI

`logColor()` helper moves here too.

**Risk:** Low — pure presentation.

---

## Stage 7: Extract pipeline stepper into a component
**Files:** `src/components/runpod/PipelineStepper.tsx`

The step indicator bar (lines ~1250–1319) — takes `pipelineStep` and renders the 6-step flow.

**Risk:** Trivial.

---

## Execution order

The safest order minimizes merge conflicts by starting from leaf extractions:

1. **Stage 1** — training args dedup (pure logic)
2. **Stage 7** — pipeline stepper (trivial UI component)
3. **Stage 2** — model search hook (isolated feature)
4. **Stage 4** — setup panel (small UI component)
5. **Stage 6** — log terminal (presentation only)
6. **Stage 5** — config sidebar (depends on 2, 4)
7. **Stage 3** — pod lifecycle hook (the big one — do last when the component is already smaller)

After all stages, `RunPodLauncher.tsx` should be ~100-150 lines: imports, hook calls, layout shell.

---

## Rules

- Build must pass after each stage (`npm run build`)
- Update CHANGELOG.md after each stage
- No behavior changes — pure structural refactor
- Each stage is one commit
