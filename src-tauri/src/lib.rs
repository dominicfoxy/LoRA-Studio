mod commands;

use tauri::Emitter;

/// Expand a leading `~` or `~/` to the user's home directory.
/// Passes through any other path unchanged.
pub(crate) fn expand_tilde(raw: &str) -> String {
    if raw == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
        return format!("{}/{}", home, rest);
    }
    raw.to_string()
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
            // Pickers
            commands::pickers::pick_directory,
            commands::pickers::pick_file,
            commands::pickers::extract_archive,
            // Forge
            commands::forge::forge_txt2img,
            commands::forge::forge_get_models,
            commands::forge::forge_get_progress,
            // Files
            commands::files::save_caption,
            commands::files::load_caption,
            commands::files::read_image_b64,
            commands::files::list_images_in_dir,
            commands::files::save_image_bytes,
            commands::files::delete_image,
            commands::files::zip_dataset,
            commands::files::save_project,
            commands::files::load_project,
            commands::files::ensure_dir,
            commands::files::path_exists,
            commands::files::list_lora_files,
            commands::files::import_and_resize_image,
            // App
            close_app,
            // RunPod
            commands::runpod::check_runpodctl,
            commands::runpod::install_runpodctl,
            commands::runpod::run_runpodctl,
            commands::runpod::setup_ssh_key,
            commands::runpod::run_ssh_command,
            commands::runpod::ssh_upload_file,
            commands::runpod::ssh_download_file,
            commands::runpod::ssh_is_ready,
            commands::runpod::fetch_gpu_prices,
            commands::runpod::fetch_pod_ssh,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn close_app(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}
