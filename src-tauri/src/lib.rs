use std::fs;
use std::io::{Write, Read};
use std::path::Path;
use tauri::Emitter;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose};
use tauri_plugin_dialog::DialogExt;

// ── Forge proxy ───────────────────────────────────────────────────────────────
// All HTTP to Forge goes through Rust/reqwest — Tauri webview blocks
// fetch() to localhost in many configurations.

#[derive(Debug, Serialize, Deserialize)]
pub struct Txt2ImgRequest {
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub steps: Option<u32>,
    pub cfg_scale: Option<f32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub sampler_name: Option<String>,
    pub scheduler: Option<String>,
    pub seed: Option<i64>,
    pub batch_size: Option<u32>,
    pub override_settings: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Txt2ImgResponse {
    pub images: Vec<String>,
    pub parameters: serde_json::Value,
    pub info: String,
}

#[tauri::command]
async fn forge_txt2img(base_url: String, params: Txt2ImgRequest) -> Result<Txt2ImgResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/sdapi/v1/txt2img", base_url.trim_end_matches('/'));

    let res = client
        .post(&url)
        .json(&params)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Forge error {}: {}", status, body));
    }

    res.json::<Txt2ImgResponse>()
        .await
        .map_err(|e| format!("Parse error: {}", e))
}

#[tauri::command]
async fn forge_get_models(base_url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/sdapi/v1/sd-models", base_url.trim_end_matches('/'));
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn forge_get_progress(base_url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/sdapi/v1/progress", base_url.trim_end_matches('/'));
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

// ── Pickers ───────────────────────────────────────────────────────────────────

#[tauri::command]
async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    rx.await.map_err(|e: tokio::sync::oneshot::error::RecvError| e.to_string())
}

#[tauri::command]
async fn pick_file(app: tauri::AppHandle, filter_name: String, extensions: Vec<String>) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    app.dialog()
        .file()
        .add_filter(&filter_name, &exts)
        .pick_file(move |file| {
            let _ = tx.send(file.map(|p| p.to_string()));
        });
    rx.await.map_err(|e: tokio::sync::oneshot::error::RecvError| e.to_string())
}

#[tauri::command]
async fn extract_archive(archive_path: String, dest_dir: String) -> Result<(), String> {
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let lower = archive_path.to_lowercase();

    if lower.ends_with(".zip") {
        let file = fs::File::open(&archive_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let out_path = Path::new(&dest_dir).join(entry.name());
            if entry.is_dir() {
                fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
            }
        }
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        let file = fs::File::open(&archive_path).map_err(|e| e.to_string())?;
        let mut archive = tar::Archive::new(GzDecoder::new(file));
        archive.unpack(&dest_dir).map_err(|e| e.to_string())?;
    } else {
        return Err(format!("Unsupported archive format: {}", archive_path));
    }

    Ok(())
}

// ── File I/O ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ImageEntry {
    pub path: String,
    pub caption: String,
    pub approved: bool,
    pub prompt: String,
}

#[tauri::command]
async fn save_caption(image_path: String, caption: String) -> Result<(), String> {
    let caption_path = Path::new(&image_path).with_extension("txt");
    fs::write(&caption_path, &caption).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_caption(image_path: String) -> Result<String, String> {
    let caption_path = Path::new(&image_path).with_extension("txt");
    if caption_path.exists() {
        fs::read_to_string(&caption_path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
async fn read_image_b64(path: String) -> Result<String, String> {
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(&buf))
}

#[tauri::command]
async fn list_images_in_dir(dir: String) -> Result<Vec<String>, String> {
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
async fn save_image_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_image(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    let caption_path = Path::new(&path).with_extension("txt");
    if caption_path.exists() {
        fs::remove_file(&caption_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn zip_dataset(dataset_dir: String, output_zip: String) -> Result<String, String> {
    let file = fs::File::create(&output_zip).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let dataset_path = Path::new(&dataset_dir);
    for entry in walkdir::WalkDir::new(dataset_path) {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
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
async fn save_project(path: String, data: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn close_app(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}

#[tauri::command]
async fn runpod_graphql(api_key: String, query: String, variables: serde_json::Value) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({ "query": query, "variables": variables });

    let res = client
        .post("https://api.runpod.io/graphql")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("RunPod error {}: {}", status, text));
    }

    res.json::<serde_json::Value>().await.map_err(|e| format!("Parse error: {}", e))
}


#[tauri::command]
async fn list_lora_files(dir: String) -> Result<Vec<String>, String> {
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

pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested-check", ());
            }
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pick_directory,
            pick_file,
            extract_archive,
            forge_txt2img,
            forge_get_models,
            forge_get_progress,
            save_caption,
            load_caption,
            read_image_b64,
            list_images_in_dir,
            save_image_bytes,
            delete_image,
            zip_dataset,
            save_project,
            load_project,
            ensure_dir,
            list_lora_files,
            close_app,
            runpod_graphql,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
