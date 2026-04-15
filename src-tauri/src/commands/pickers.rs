use std::fs;
use std::path::Path;
use flate2::read::GzDecoder;
use tauri_plugin_dialog::DialogExt;

use crate::expand_tilde;

#[tauri::command]
pub async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    rx.await.map_err(|e: tokio::sync::oneshot::error::RecvError| e.to_string())
}

#[tauri::command]
pub async fn pick_file(app: tauri::AppHandle, filter_name: String, extensions: Vec<String>) -> Result<Option<String>, String> {
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
pub async fn extract_archive(archive_path: String, dest_dir: String) -> Result<(), String> {
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
