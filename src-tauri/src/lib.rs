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
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
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

// ── Jupyter helpers ───────────────────────────────────────────────────────────

// Returns (client, xsrf_token, cookie_header_for_websocket)
async fn jupyter_client_login(jupyter_url: &str, password: &str) -> Result<(reqwest::Client, String, String), String> {
    // No-redirect client to capture Set-Cookie from the 302 login response directly
    let bare = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let login_url = format!("{}/login", jupyter_url);

    // GET login page — _xsrf cookie comes back in Set-Cookie
    let get_res = bare.get(&login_url).send().await.map_err(|e| e.to_string())?;

    // Collect all cookies from GET response
    let mut cookies: Vec<String> = get_res.headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|s| s.split(';').next())
        .map(|s| s.to_string())
        .collect();

    // Extract _xsrf value
    let xsrf = cookies.iter()
        .find(|s| s.contains("_xsrf="))
        .and_then(|s| s.split("_xsrf=").nth(1))
        .map(|s| s.to_string())
        .unwrap_or_default();

    let xsrf = if xsrf.is_empty() {
        let html = get_res.text().await.unwrap_or_default();
        html.split("_xsrf").find_map(|chunk| {
            chunk.split("value=\"").nth(1).and_then(|s| {
                let v = s.split('"').next().unwrap_or("");
                if v.is_empty() { None } else { Some(v.to_string()) }
            })
        }).unwrap_or_default()
    } else {
        xsrf
    };

    // Build Cookie header to send with POST (so server can validate _xsrf)
    let cookie_for_post = cookies.join("; ");

    // POST login with no-redirect so we get the 302 Set-Cookie directly
    let body = format!("_xsrf={}&password={}", urlencoding::encode(&xsrf), urlencoding::encode(password));
    let post_res = bare.post(&login_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("X-XSRFToken", &xsrf)
        .header("Cookie", &cookie_for_post)
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // Session cookie is in the 302 response Set-Cookie (before redirect)
    for val in post_res.headers().get_all("set-cookie").iter() {
        if let Ok(s) = val.to_str() {
            if let Some(nv) = s.split(';').next() {
                let name = nv.split('=').next().unwrap_or("");
                if !cookies.iter().any(|c| c.split('=').next() == Some(name)) {
                    cookies.push(nv.to_string());
                }
            }
        }
    }

    let cookie_header = cookies.join("; ");

    // Plain client — no cookie store; callers pass Cookie header explicitly
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    Ok((client, xsrf, cookie_header))
}

#[tauri::command]
async fn jupyter_is_ready(jupyter_url: String, password: String) -> bool {
    // Login and check the terminal API — confirms Jupyter is fully up, not just the login page
    match jupyter_client_login(&jupyter_url, &password).await {
        Ok((client, _xsrf, cookie_header)) => {
            client.get(format!("{}/api/terminals", jupyter_url))
                .header("Cookie", &cookie_header)
                .send().await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
        }
        Err(_) => false,
    }
}

#[tauri::command]
async fn jupyter_upload_file(jupyter_url: String, password: String, remote_path: String, local_path: String) -> Result<(), String> {
    let (client, xsrf, cookie_header) = jupyter_client_login(&jupyter_url, &password).await?;

    let mut file = fs::File::open(&local_path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(&buf);

    let url = format!("{}/api/contents/{}", jupyter_url, remote_path);
    let body = serde_json::json!({ "type": "file", "format": "base64", "content": b64 });

    let res = client.put(&url)
        .header("Cookie", &cookie_header)
        .header("X-XSRFToken", &xsrf)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Jupyter upload failed ({}): {}", status, text));
    }
    Ok(())
}

#[tauri::command]
async fn jupyter_run_command(jupyter_url: String, password: String, command: String) -> Result<(), String> {
    jupyter_terminal_send(&jupyter_url, &password, &command, None).await
}


async fn jupyter_terminal_send(jupyter_url: &str, password: &str, command: &str, wait_secs: Option<u64>) -> Result<(), String> {
    use tokio_tungstenite::tungstenite::Message;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::header;
    use futures_util::{SinkExt, StreamExt};

    let (client, xsrf, cookie_header) = jupyter_client_login(jupyter_url, password).await?;

    // Create a new terminal — verify it succeeds and capture the terminal name
    let term_url = format!("{}/api/terminals", jupyter_url);
    let term_res = client.post(&term_url)
        .header("Cookie", &cookie_header)
        .header("X-XSRFToken", &xsrf)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| format!("Terminal create failed: {}", e))?;

    if !term_res.status().is_success() {
        let status = term_res.status();
        let body = term_res.text().await.unwrap_or_default();
        return Err(format!("Could not create terminal ({}): {}", status, body));
    }

    let term: serde_json::Value = term_res.json().await.map_err(|e| e.to_string())?;
    // name may be a JSON string or number depending on Jupyter version
    let term_name = term["name"].as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| term["name"].as_i64().unwrap_or(1).to_string());

    // Build WSS URL
    let ws_url = format!(
        "{}/terminals/websocket/{}",
        jupyter_url.replace("https://", "wss://").replace("http://", "ws://"),
        term_name
    );

    // Use into_client_request() — the correct tungstenite API that sets Method + Host
    let mut request = ws_url.as_str()
        .into_client_request()
        .map_err(|e| format!("WS request build failed: {}", e))?;

    {
        let h = request.headers_mut();
        use tokio_tungstenite::tungstenite::http::header::InvalidHeaderValue;
        let parse = |s: &str| -> Result<tokio_tungstenite::tungstenite::http::HeaderValue, String> {
            s.parse::<tokio_tungstenite::tungstenite::http::HeaderValue>().map_err(|e: InvalidHeaderValue| e.to_string())
        };
        h.insert(header::ORIGIN,    parse(jupyter_url)?);
        h.insert(header::COOKIE,    parse(&cookie_header)?);
        h.insert("x-xsrftoken",     parse(&xsrf)?);
        h.insert("sec-websocket-protocol", parse("v1.terminal.jupyter.org")?);
    }

    let (mut ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| {
            // Expose HTTP status when the server rejects the upgrade
            let detail = match &e {
                tokio_tungstenite::tungstenite::Error::Http(resp) => {
                    format!("HTTP {} (url={})", resp.status(), ws_url)
                }
                other => format!("{:?} (url={})", other, ws_url),
            };
            format!("WS connect failed: {}", detail)
        })?;

    // Send command
    let msg = serde_json::json!(["stdin", format!("{}\n", command)]);
    ws.send(Message::Text(msg.to_string()))
        .await
        .map_err(|e| format!("WS send failed: {}", e))?;

    if let Some(secs) = wait_secs {
        // Wait for "DONE" marker in terminal output, up to `secs` seconds
        let deadline = std::time::Duration::from_secs(secs);
        let result = tokio::time::timeout(deadline, async {
            while let Some(Ok(msg)) = ws.next().await {
                if let Message::Text(text) = msg {
                    if let Ok(arr) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(content) = arr.get(1).and_then(|v| v.as_str()) {
                            if content.contains("DONE") {
                                return;
                            }
                        }
                    }
                }
            }
        }).await;
        if result.is_err() {
            // Timeout — command may still be running; not fatal
        }
    } else {
        // Fire and forget — give the terminal 300ms to process before closing
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    let _ = ws.close(None).await;
    Ok(())
}

#[tauri::command]
async fn jupyter_list_dir(jupyter_url: String, password: String, remote_path: String) -> Result<Vec<String>, String> {
    let (client, _xsrf, cookie_header) = jupyter_client_login(&jupyter_url, &password).await?;
    let url = format!("{}/api/contents/{}?content=1&type=directory", jupyter_url, remote_path);
    let res = client.get(&url)
        .header("Cookie", &cookie_header)
        .send().await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("list failed ({})", res.status()));
    }
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let names = json["content"].as_array()
        .ok_or("missing content field")?
        .iter()
        .filter_map(|f| f["name"].as_str().map(|n| n.to_string()))
        .collect();
    Ok(names)
}

#[tauri::command]
async fn jupyter_download_file(jupyter_url: String, password: String, remote_path: String, local_path: String) -> Result<(), String> {
    let (client, _xsrf, cookie_header) = jupyter_client_login(&jupyter_url, &password).await?;
    let url = format!("{}/api/contents/{}?content=1&format=base64&type=file", jupyter_url, remote_path);
    let res = client.get(&url)
        .header("Cookie", &cookie_header)
        .send().await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("download failed ({})", res.status()));
    }
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let b64 = json["content"].as_str().ok_or("missing content field")?;
    let b64_clean: String = b64.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    let bytes = general_purpose::STANDARD.decode(&b64_clean).map_err(|e| e.to_string())?;
    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&local_path, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn jupyter_read_file(jupyter_url: String, password: String, remote_path: String) -> Result<String, String> {
    let (client, _xsrf, cookie_header) = jupyter_client_login(&jupyter_url, &password).await?;
    let url = format!("{}/api/contents/{}?content=1&format=text&type=file", jupyter_url, remote_path);
    let res = client.get(&url)
        .header("Cookie", &cookie_header)
        .send().await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("read failed ({})", res.status()));
    }
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json["content"].as_str().unwrap_or("").to_string())
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
            runpod_graphql,
            jupyter_is_ready,
            jupyter_upload_file,
            jupyter_run_command,
            jupyter_read_file,
            jupyter_list_dir,
            jupyter_download_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
