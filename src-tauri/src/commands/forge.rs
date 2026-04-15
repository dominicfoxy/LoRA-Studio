use serde::{Deserialize, Serialize};

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
pub async fn forge_txt2img(base_url: String, params: Txt2ImgRequest) -> Result<Txt2ImgResponse, String> {
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
pub async fn forge_get_models(base_url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/sdapi/v1/sd-models", base_url.trim_end_matches('/'));
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn forge_get_progress(base_url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/sdapi/v1/progress", base_url.trim_end_matches('/'));
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    res.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}
