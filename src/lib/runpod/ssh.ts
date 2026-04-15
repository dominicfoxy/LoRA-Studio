import { invoke } from "@tauri-apps/api/core";

export function sshIsReady(host: string, port: number, keyPath: string): Promise<boolean> {
  return invoke<boolean>("ssh_is_ready", { host, port, keyPath });
}

export function sshRunCommand(host: string, port: number, keyPath: string, command: string): Promise<string> {
  return invoke<string>("run_ssh_command", { host, port, keyPath, command });
}

export function sshUploadFile(host: string, port: number, keyPath: string, localPath: string, remotePath: string): Promise<void> {
  return invoke("ssh_upload_file", { host, port, keyPath, localPath, remotePath });
}

export function sshDownloadFile(host: string, port: number, keyPath: string, remotePath: string, localPath: string): Promise<void> {
  return invoke("ssh_download_file", { host, port, keyPath, remotePath, localPath });
}
