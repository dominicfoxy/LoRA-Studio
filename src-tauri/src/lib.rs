use std::fs;
use std::io::{Write, Read};
use std::path::Path;
use tauri::Emitter;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose};
use tauri_plugin_dialog::DialogExt;

/// Expand a leading `~` or `~/` to the user's home directory.
/// Passes through any other path unchanged.
fn expand_tilde(raw: &str) -> String {
    if raw == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
        return format!("{}/{}", home, rest);
    }
    raw.to_string()
}

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
    let archive_path = expand_tilde(&archive_path);
    let dest_dir = expand_tilde(&dest_dir);
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
    let image_path = expand_tilde(&image_path);
    let caption_path = Path::new(&image_path).with_extension("txt");
    fs::write(&caption_path, &caption).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_caption(image_path: String) -> Result<String, String> {
    let image_path = expand_tilde(&image_path);
    let caption_path = Path::new(&image_path).with_extension("txt");
    if caption_path.exists() {
        fs::read_to_string(&caption_path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
async fn read_image_b64(path: String) -> Result<String, String> {
    let path = expand_tilde(&path);
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(&buf))
}

#[tauri::command]
async fn list_images_in_dir(dir: String) -> Result<Vec<String>, String> {
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
async fn save_image_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    let path = expand_tilde(&path);
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_image(path: String) -> Result<(), String> {
    let path = expand_tilde(&path);
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    let caption_path = Path::new(&path).with_extension("txt");
    if caption_path.exists() {
        fs::remove_file(&caption_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn zip_dataset(dataset_dir: String, output_zip: String, include_paths: Option<Vec<String>>) -> Result<String, String> {
    let dataset_dir = expand_tilde(&dataset_dir);
    let output_zip = expand_tilde(&output_zip);
    let include_paths = include_paths.map(|paths| paths.iter().map(|p| expand_tilde(p)).collect::<Vec<_>>());
    let file = fs::File::create(&output_zip).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let dataset_path = Path::new(&dataset_dir);

    // If include_paths is provided, only zip those files (+ their .txt sidecars).
    // Otherwise fall back to zipping all image/txt files in the directory.
    if let Some(ref paths) = include_paths {
        let mut to_zip: Vec<std::path::PathBuf> = Vec::new();
        for p in paths {
            let img = Path::new(p);
            if img.is_file() { to_zip.push(img.to_path_buf()); }
            // Include the .txt sidecar if it exists
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
async fn save_project(path: String, data: String) -> Result<(), String> {
    let path = expand_tilde(&path);
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_project(path: String) -> Result<String, String> {
    let path = expand_tilde(&path);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn ensure_dir(path: String) -> Result<(), String> {
    let path = expand_tilde(&path);
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    let path = expand_tilde(&path);
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn close_app(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}



// ── runpodctl + SSH ───────────────────────────────────────────────────────────

fn runpodctl_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let local_bin = format!("{}/.local/bin/runpodctl", home);
    if std::path::Path::new(&local_bin).exists() {
        local_bin
    } else {
        "runpodctl".to_string()
    }
}

#[tauri::command]
async fn check_runpodctl() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let local_bin = format!("{}/.local/bin/runpodctl", home);
    if std::path::Path::new(&local_bin).exists() {
        return true;
    }
    std::process::Command::new("which")
        .arg("runpodctl")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
async fn install_runpodctl() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let local_bin = format!("{}/.local/bin", home);
    let dest = format!("{}/runpodctl", local_bin);
    fs::create_dir_all(&local_bin).map_err(|e| e.to_string())?;
    let script = format!(
        "curl -fsSL -o {dest} https://github.com/runpod/runpodctl/releases/latest/download/runpodctl-linux-amd64 && chmod +x {dest}",
        dest = dest
    );
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("bash").args(["-c", &script]).output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("Install failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(dest)
}

#[tauri::command]
async fn run_runpodctl(args: Vec<String>, api_key: String) -> Result<String, String> {
    let bin = runpodctl_path();
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&bin)
            .args(&args)
            .env("RUNPOD_API_KEY", &api_key)
            .output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!("{} {}", stderr, stdout).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn setup_ssh_key(api_key: String) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let config_dir = format!("{}/.config/lora-studio", home);
    let key_path = format!("{}/runpod_id_ed25519", config_dir);
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    // Generate key pair only if it doesn't exist yet
    if !std::path::Path::new(&key_path).exists() {
        let kp = key_path.clone();
        let gen_out = tokio::task::spawn_blocking(move || {
            std::process::Command::new("ssh-keygen")
                .args(["-t", "ed25519", "-f", &kp, "-N", ""])
                .output()
        }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
        if !gen_out.status.success() {
            return Err(format!("ssh-keygen failed: {}", String::from_utf8_lossy(&gen_out.stderr)));
        }
    }
    // Register public key with RunPod (pass key content, not file path)
    let pub_key_path = format!("{}.pub", key_path);
    let pub_key_content = fs::read_to_string(&pub_key_path).map_err(|e| e.to_string())?;
    let pub_key_content = pub_key_content.trim().to_string();
    let bin = runpodctl_path();
    let reg_out = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&bin)
            .args(["ssh", "add-key", "--key", &pub_key_content])
            .env("RUNPOD_API_KEY", &api_key)
            .output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if !reg_out.status.success() {
        let stderr = String::from_utf8_lossy(&reg_out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&reg_out.stdout).to_string();
        return Err(format!("ssh add-key failed: {} {}", stderr, stdout).trim().to_string());
    }
    Ok(key_path)
}

#[tauri::command]
async fn run_ssh_command(host: String, port: u16, key_path: String, command: String) -> Result<String, String> {
    let key_path = expand_tilde(&key_path);
    let port_str = port.to_string();
    let remote = format!("root@{}", host);
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("ssh")
            .args([
                "-i", &key_path,
                "-p", &port_str,
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                "-o", "ConnectTimeout=10",
                &remote,
                &command,
            ])
            .output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("SSH error (exit {}): {}",
            output.status.code().unwrap_or(-1),
            if stderr.is_empty() { &stdout } else { &stderr }
        ));
    }
    Ok(stdout)
}

#[tauri::command]
async fn ssh_upload_file(host: String, port: u16, key_path: String, local_path: String, remote_path: String) -> Result<(), String> {
    let local_path = expand_tilde(&local_path);
    let key_path = expand_tilde(&key_path);
    let port_str = port.to_string();
    let dest = format!("root@{}:{}", host, remote_path);
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("scp")
            .args([
                "-i", &key_path,
                "-P", &port_str,
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                &local_path,
                &dest,
            ])
            .output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("SCP upload failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

#[tauri::command]
async fn ssh_download_file(host: String, port: u16, key_path: String, remote_path: String, local_path: String) -> Result<(), String> {
    let local_path = expand_tilde(&local_path);
    let key_path = expand_tilde(&key_path);
    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let port_str = port.to_string();
    let src = format!("root@{}:{}", host, remote_path);
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("scp")
            .args([
                "-i", &key_path,
                "-P", &port_str,
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                &src,
                &local_path,
            ])
            .output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("SCP download failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

#[tauri::command]
async fn ssh_is_ready(host: String, port: u16, key_path: String) -> Result<bool, String> {
    let key_path = expand_tilde(&key_path);
    let port_str = port.to_string();
    let remote = format!("root@{}", host);
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("ssh")
            .args([
                "-i", &key_path,
                "-p", &port_str,
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=/dev/null",
                "-o", "ConnectTimeout=5",
                "-o", "BatchMode=yes",
                &remote,
                "exit 0",
            ])
            .output()
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

// ── RunPod GraphQL (pricing only — CORS blocks fetch() from webview) ──────────

#[tauri::command]
async fn fetch_gpu_prices(api_key: String) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({
        "query": "{ gpuTypes { displayName lowestPrice(input: { gpuCount: 1 }) { minimumBidPrice uninterruptablePrice } } }"
    });
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.runpod.io/graphql")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn fetch_pod_ssh(api_key: String, pod_id: String) -> Result<serde_json::Value, String> {
    let query = format!(
        r#"{{ pod(input: {{ podId: "{}" }}) {{ id runtime {{ ports {{ ip isIpPublic privatePort publicPort type }} uptimeInSeconds }} }} }}"#,
        pod_id
    );
    let body = serde_json::json!({ "query": query });
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.runpod.io/graphql")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn list_lora_files(dir: String) -> Result<Vec<String>, String> {
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
            path_exists,
            list_lora_files,
            close_app,
            check_runpodctl,
            install_runpodctl,
            run_runpodctl,
            setup_ssh_key,
            run_ssh_command,
            ssh_upload_file,
            ssh_download_file,
            ssh_is_ready,
            fetch_gpu_prices,
            fetch_pod_ssh,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
