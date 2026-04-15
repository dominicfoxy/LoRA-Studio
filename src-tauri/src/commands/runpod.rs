use std::fs;

use crate::expand_tilde;

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
pub async fn check_runpodctl() -> bool {
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
pub async fn install_runpodctl() -> Result<String, String> {
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
pub async fn run_runpodctl(args: Vec<String>, api_key: String) -> Result<String, String> {
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
pub async fn setup_ssh_key(api_key: String) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let config_dir = format!("{}/.config/lora-studio", home);
    let key_path = format!("{}/runpod_id_ed25519", config_dir);
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
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
pub async fn run_ssh_command(host: String, port: u16, key_path: String, command: String) -> Result<String, String> {
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
pub async fn ssh_upload_file(host: String, port: u16, key_path: String, local_path: String, remote_path: String) -> Result<(), String> {
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
pub async fn ssh_download_file(host: String, port: u16, key_path: String, remote_path: String, local_path: String) -> Result<(), String> {
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
pub async fn ssh_is_ready(host: String, port: u16, key_path: String) -> Result<bool, String> {
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

#[tauri::command]
pub async fn fetch_gpu_prices(api_key: String) -> Result<serde_json::Value, String> {
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
pub async fn fetch_pod_ssh(api_key: String, pod_id: String) -> Result<serde_json::Value, String> {
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
