use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::settings::AppSettings;

const KEY: &str = match option_env!("POSTHOG_KEY") {
    Some(key) => key,
    None => "",
};
const URL: &str = "https://us.i.posthog.com/i/v0/e/";

static LAUNCH: LazyLock<String> = LazyLock::new(|| {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.as_nanos());
    format!("{nanos:x}{:x}", std::process::id())
});

pub(crate) fn send(app: &AppHandle, event: &'static str, extra: Value) {
    if KEY.is_empty() || !app.state::<AppSettings>().current().shares_usage {
        return;
    }
    let mut properties = json!({
        "$process_person_profile": false,
        "$geoip_disable": true,
        "version": app.package_info().version.to_string(),
        "dev": cfg!(debug_assertions),
    });
    if let (Some(all), Value::Object(extra)) = (properties.as_object_mut(), extra) {
        all.extend(extra);
    }
    let body = json!({
        "api_key": KEY,
        "event": event,
        "distinct_id": *LAUNCH,
        "properties": properties,
    });
    tauri::async_runtime::spawn(async move {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let sent = reqwest::Client::new().post(URL).json(&body).send().await;
        if let Err(err) = sent.and_then(|response| response.error_for_status()) {
            log::warn!("could not send usage: {err}");
        }
    });
}
