# Casting Couch

A Tauri desktop app for end-to-end character LoRA creation — from shot list to RunPod training.

## Workflow

```
Character Setup → Shot List → Batch Generate → Caption Review → RunPod Launch
```

## Prerequisites

### Ubuntu setup (one-time)

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Tauri system deps
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libgtk-3-dev \
  libglib2.0-dev \
  libjavascriptcoregtk-4.1-dev

# Node (if not already installed via nvm)
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 20
```

### Forge WebUI API

Make sure Forge is running with the API enabled:
```bash
# Add --api to your launch command
./webui.sh --api
# Or in your Stability Matrix launch args, add: --api
```

## Installation

**Pre-built releases** are available on the [Releases](https://github.com/dominicfoxy/LoRA-Studio/releases) page:
- Linux: prefer `.deb` over `.AppImage` — the AppImage bundles WebKitGTK and is much larger
- macOS: `.dmg` (right-click → Open if Gatekeeper blocks it)
- Windows: `.msi` or `.exe` (click "More info" → "Run anyway" if SmartScreen appears)

**Build from source:**
```bash
git clone https://github.com/dominicfoxy/LoRA-Studio lora-studio
cd lora-studio
npm install
npm run tauri dev    # development mode
npm run tauri build  # production build
```

## Usage

### 1. Character Setup
- Set character name, trigger word (short, unique, lowercase+underscore)
- Core description: comma-separated booru tags present in every image
  - Example: `anthro, red fox, female, orange fur, white chest, amber eyes`
- Set your Illustrious checkpoint filename as Forge knows it
- Set output directory (NAS mount works fine)

### 2. Shot List
- Define shot types: pose, outfit, expression, background
- Use preset buttons or type custom booru tags
- Set image count per shot (3-5 recommended per variant)
- Preview full prompt in real-time

### 3. Batch Generator
- Click **Generate All Shots** — sends to Forge API sequentially
- Images save to output directory with `.txt` caption sidecars
- **Approve** (✓) or **Reject** (✗) each result
- Rejected images → click **Requeue Rejected** to regenerate with new seeds

### 4. Caption Editor
- Filter to Approved images
- Each image shows its derived booru caption (from generation prompt)
- Edit via tag chips (click × to remove) or raw textarea
- Trigger word is pinned first, highlighted in amber
- **Add tag to all** — type a tag in the Dataset Tags header and press Enter or "+ All" to append it to every visible image at once
- **Save All** writes all `.txt` sidecars

### 5. RunPod Launcher
- Select GPU and cloud type (SECURE/COMMUNITY/ALL)
- Optionally select a **Network Volume** to cache the base model across runs
- Set base model via search (CivitAI → HuggingFace) or local path
- Toggle **SDXL** or **SD 1.5** to match your checkpoint architecture
- Set training hyperparameters (steps, UNet LR, Text Encoder LR, network dim, network alpha, noise offset, min SNR gamma, resolution)
- Choose **Final LoRA only** or **Final + intermediates** for auto-download
- **Package & Launch** → the app handles everything automatically:
  - Zips dataset, spins up Kohya pod, uploads dataset + config
  - Downloads or uploads base model checkpoint
  - Launches training with GPU-optimised config (batch size, gradient checkpointing, cache_latents tuned to VRAM)
  - Streams training logs in real-time
  - Downloads finished LoRA to your `loraDir` on completion

## Training Tips (Illustrious SDXL)

| Parameter | Recommended | Notes |
|---|---|---|
| Network dim | 32 | Higher absorbs style/colour from training data; 32 is the sweet spot for character LoRAs |
| Network alpha | 16 | Half of dim is standard |
| UNet LR | 5e-5 | Main diffusion network learning rate |
| Text Encoder LR | 1e-5 | Lower than UNet to preserve text understanding |
| Steps | 1500–2500 | ~15 steps/image is a good ratio |
| Noise offset | 0.0357 | Mild contrast/saturation boost for SD1.x; ignored for SDXL |
| Min SNR Gamma | 5 | Stabilises loss weighting across noise levels; set to 0 to disable |
| Resolution | 1024 | Illustrious native resolution |
| Batch size | auto | Tuned to GPU VRAM (1–4) |
| Optimizer | AdamW8bit | Memory efficient |
| Mixed precision | bf16 | Better dynamic range than fp16; avoids overflow on Ampere+ GPUs |
| V-Prediction | off | Enable for NoobAI-XL and other v-pred models. Standard SDXL uses epsilon — leave off. Adds `--v_parameterization --zero_terminal_snr` |

## Dataset Recommendations

- **Minimum**: 10 images
- **Good**: 20-30 images
- **Mix**: varied poses, outfits, expressions, backgrounds
- **Keep** trigger word first in every caption
- **Avoid** having the character face off-screen or heavily occluded in more than 20% of images

## File Structure

```
output_dir/
  *.png                     # generated images
  *.txt                     # caption sidecars (one per image)
  project.json              # project state (save from Character Setup)
  kohya_config.toml         # generated training config
  training_command.txt      # full training command (for debugging)
  <trigger>_dataset.zip     # packaged dataset for RunPod upload
```

## RunPod Notes

- Training is fully automated — no manual Jupyter interaction required
- A **Network Volume** caches the base model between runs, avoiding repeated 6GB+ downloads. Volumes are datacenter-specific; if your chosen GPU isn't available in the volume's datacenter, the app will launch without the volume and download fresh automatically
- The finished LoRA downloads to your character's output directory when training completes
- **Auto-terminate** is enabled by default — the pod is stopped automatically after a successful download. Disable with the toggle in the launcher if you want to keep it running.

## Architecture

- **Frontend**: React + TypeScript + Zustand (state)
- **Backend**: Rust (Tauri) — file I/O, zip packaging, caption sidecars  
- **Forge API**: A1111-compatible REST (`/sdapi/v1/txt2img`)
- **RunPod API**: GraphQL (`api.runpod.io/graphql`)
- **Trainer**: Kohya sd-scripts on RunPod pod
