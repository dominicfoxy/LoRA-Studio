# LoRA Studio

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

```bash
git clone <this-repo> lora-studio
cd lora-studio
npm install
npm run tauri dev    # development mode
npm run tauri build  # production AppImage
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
- **Save All** writes all `.txt` sidecars

### 5. RunPod Launcher
- Configure GPU (A100 40GB recommended for SDXL, ~$1.64 USD/hr)
- Set training hyperparameters
- **Package Dataset** → zips approved images + captions + generates `kohya_config.toml`
- **Launch Training Pod** → spins up Kohya pod on RunPod
- Follow log output for pod URL, then upload dataset and run training command

## Training Tips (Illustrious SDXL)

| Parameter | Recommended | Notes |
|---|---|---|
| Network dim | 32 | Higher = more capacity but larger file |
| Network alpha | 16 | Half of dim is standard |
| Learning rate | 1e-4 | Lower = more conservative |
| Steps | 1500–2500 | ~15 steps/image is a good ratio |
| Resolution | 1024 | Illustrious native resolution |
| Batch size | 1 | Safe for 24GB VRAM |
| Optimizer | AdamW8bit | Memory efficient |

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
  <trigger>_dataset.zip     # packaged dataset for RunPod upload
```

## RunPod Pod Setup

After pod launches and shows RUNNING:
1. Open Jupyter at the provided URL (password: `lorastudio`)
2. Upload `<trigger>_dataset.zip` → extract to `/workspace/dataset/`
3. Upload `kohya_config.toml` → `/workspace/`
4. Upload your base model `.safetensors` → `/workspace/models/`
5. Open terminal in Jupyter, run:
   ```bash
   python /workspace/kohya_ss/train_network.py --config_file /workspace/kohya_config.toml
   ```
6. Sample images saved every 100 steps to `/workspace/output/sample/`
7. Final LoRA at `/workspace/output/<trigger>_lora.safetensors`
8. Download and terminate pod

## Architecture

- **Frontend**: React + TypeScript + Zustand (state)
- **Backend**: Rust (Tauri) — file I/O, zip packaging, caption sidecars  
- **Forge API**: A1111-compatible REST (`/sdapi/v1/txt2img`)
- **RunPod API**: GraphQL (`api.runpod.io/graphql`)
- **Trainer**: Kohya sd-scripts on RunPod pod
