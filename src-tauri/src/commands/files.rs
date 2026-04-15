use std::fs;
use std::io::{Write, Read};
use std::path::Path;
use base64::{Engine as _, engine::general_purpose};
use image::{GenericImageView, ImageBuffer, Rgba, imageops::FilterType};

use crate::expand_tilde;

#[tauri::command]
pub async fn save_caption(image_path: String, caption: String) -> Result<(), String> {
    let image_path = expand_tilde(&image_path);
    let caption_path = Path::new(&image_path).with_extension("txt");
    fs::write(&caption_path, &caption).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_caption(image_path: String) -> Result<String, String> {
    let image_path = expand_tilde(&image_path);
    let caption_path = Path::new(&image_path).with_extension("txt");
    if caption_path.exists() {
        fs::read_to_string(&caption_path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn read_image_b64(path: String) -> Result<String, String> {
    let path = expand_tilde(&path);
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(&buf))
}

#[tauri::command]
pub async fn list_images_in_dir(dir: String) -> Result<Vec<String>, String> {
    let dir = expand_tilde(&dir);
    let path = Path::new(&dir);
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut images = vec![];
    for entry in walkdir::WalkDir::new(path).max_depth(1) {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if let Some(ext) = p.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                images.push(p.to_string_lossy().to_string());
            }
        }
    }
    images.sort();
    Ok(images)
}

#[tauri::command]
pub async fn save_image_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    let path = expand_tilde(&path);
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_image(path: String) -> Result<(), String> {
    let path = expand_tilde(&path);
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    let caption_path = Path::new(&path).with_extension("txt");
    if caption_path.exists() {
        fs::remove_file(&caption_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn zip_dataset(dataset_dir: String, output_zip: String, include_paths: Option<Vec<String>>) -> Result<String, String> {
    let dataset_dir = expand_tilde(&dataset_dir);
    let output_zip = expand_tilde(&output_zip);
    let include_paths = include_paths.map(|paths| paths.iter().map(|p| expand_tilde(p)).collect::<Vec<_>>());
    let file = fs::File::create(&output_zip).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let dataset_path = Path::new(&dataset_dir);

    if let Some(ref paths) = include_paths {
        let mut to_zip: Vec<std::path::PathBuf> = Vec::new();
        for p in paths {
            let img = Path::new(p);
            if img.is_file() { to_zip.push(img.to_path_buf()); }
            let sidecar = img.with_extension("txt");
            if sidecar.is_file() { to_zip.push(sidecar); }
        }
        for path in &to_zip {
            let rel = path.strip_prefix(dataset_path).map_err(|e| e.to_string())?;
            zip.start_file(rel.to_string_lossy(), options).map_err(|e| e.to_string())?;
            let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            zip.write_all(&buf).map_err(|e| e.to_string())?;
        }
    } else {
        let output_zip_path = Path::new(&output_zip);
        for entry in walkdir::WalkDir::new(dataset_path) {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_file() { continue; }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "txt") { continue; }
            if path == output_zip_path { continue; }
            let rel = path.strip_prefix(dataset_path).map_err(|e| e.to_string())?;
            zip.start_file(rel.to_string_lossy(), options).map_err(|e| e.to_string())?;
            let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            zip.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(output_zip)
}

#[tauri::command]
pub async fn save_project(path: String, data: String) -> Result<(), String> {
    let path = expand_tilde(&path);
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_project(path: String) -> Result<String, String> {
    let path = expand_tilde(&path);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ensure_dir(path: String) -> Result<(), String> {
    let path = expand_tilde(&path);
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    let path = expand_tilde(&path);
    std::path::Path::new(&path).exists()
}

#[tauri::command]
pub async fn list_lora_files(dir: String) -> Result<Vec<String>, String> {
    let dir = expand_tilde(&dir);
    let path = Path::new(&dir);
    if !path.exists() { return Ok(vec![]); }
    let mut files = vec![];
    for entry in walkdir::WalkDir::new(path) {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if let Some(ext) = p.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            if ["safetensors", "pt", "ckpt"].contains(&ext.as_str()) {
                files.push(p.to_string_lossy().to_string());
            }
        }
    }
    files.sort();
    Ok(files)
}

/// Import an external image, resizing/cropping/padding it to exact target dimensions.
/// fit_mode: "crop" | "pad-black" | "pad-white" | "stretch"
#[tauri::command]
pub async fn import_and_resize_image(
    src: String,
    dest: String,
    target_w: u32,
    target_h: u32,
    fit_mode: String,
) -> Result<String, String> {
    let src = expand_tilde(&src);
    let dest = expand_tilde(&dest);

    let img = image::open(&src).map_err(|e| format!("Failed to open image: {}", e))?;
    let (sw, sh) = img.dimensions();

    let output: ImageBuffer<Rgba<u8>, Vec<u8>> = match fit_mode.as_str() {
        "crop" => {
            // Center-crop to target aspect ratio, then resize
            let target_ratio = target_w as f64 / target_h as f64;
            let src_ratio = sw as f64 / sh as f64;

            let (crop_w, crop_h) = if src_ratio > target_ratio {
                // Source is wider — crop sides
                let cw = (sh as f64 * target_ratio).round() as u32;
                (cw.min(sw), sh)
            } else {
                // Source is taller — crop top/bottom
                let ch = (sw as f64 / target_ratio).round() as u32;
                (sw, ch.min(sh))
            };
            let x = (sw - crop_w) / 2;
            let y = (sh - crop_h) / 2;
            let cropped = img.crop_imm(x, y, crop_w, crop_h);
            image::imageops::resize(&cropped.to_rgba8(), target_w, target_h, FilterType::Lanczos3)
        }
        "pad-black" | "pad-white" => {
            let fill: Rgba<u8> = if fit_mode == "pad-black" {
                Rgba([0, 0, 0, 255])
            } else {
                Rgba([255, 255, 255, 255])
            };
            // Resize to fit within target, pad remainder
            let scale = (target_w as f64 / sw as f64).min(target_h as f64 / sh as f64);
            let new_w = (sw as f64 * scale).round() as u32;
            let new_h = (sh as f64 * scale).round() as u32;
            let resized = image::imageops::resize(&img.to_rgba8(), new_w, new_h, FilterType::Lanczos3);
            let mut canvas = ImageBuffer::from_pixel(target_w, target_h, fill);
            let ox = (target_w - new_w) / 2;
            let oy = (target_h - new_h) / 2;
            image::imageops::overlay(&mut canvas, &resized, ox as i64, oy as i64);
            canvas
        }
        "stretch" => {
            image::imageops::resize(&img.to_rgba8(), target_w, target_h, FilterType::Lanczos3)
        }
        _ => return Err(format!("Unknown fit_mode: {}", fit_mode)),
    };

    if let Some(parent) = Path::new(&dest).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    output.save(&dest).map_err(|e| format!("Failed to save image: {}", e))?;
    Ok(dest)
}
