use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use anyhow::{Context, Result, ensure};
use cidre::cg;
use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{
    AppHandle, Manager, State, Theme, WebviewUrl, WebviewWindowBuilder, path::BaseDirectory,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::Shortcut;
use ts_rs::TS;

use crate::current_recording::CurrentRecording;
use crate::util::{CmdResult, lock, run_blocking};
use crate::{PageEvent, tray};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct Settings {
    pub save_folder: Option<String>,
    #[ts(type = "unknown")]
    pub export: Option<serde_json::Value>,
    #[ts(type = "unknown")]
    pub appearance: Option<serde_json::Value>,
    pub suggests_edits: bool,
    pub record_shortcut: String,
    pub counts_down: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            save_folder: None,
            export: None,
            appearance: None,
            suggests_edits: true,
            record_shortcut: "Alt+Shift+KeyR".into(),
            counts_down: true,
        }
    }
}

pub(crate) const WINDOW: &str = "settings";

pub(crate) struct AppSettings {
    path: PathBuf,
    settings: Mutex<Settings>,
}

impl AppSettings {
    pub(crate) fn load(path: PathBuf) -> Self {
        let settings = read(&path);
        Self {
            path,
            settings: Mutex::new(settings),
        }
    }

    pub(crate) fn current(&self) -> Settings {
        lock(&self.settings).clone()
    }

    fn save(&self, settings: Settings) -> Result<()> {
        if let Some(folder) = self.path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(&settings)?)
            .with_context(|| format!("could not save {}", self.path.display()))?;
        *lock(&self.settings) = settings;
        Ok(())
    }
}

fn read(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub(crate) fn apply(app: &AppHandle) {
    let settings = app.state::<AppSettings>().current();
    if let Err(err) = tray::set_record_shortcut(app, &settings.record_shortcut) {
        log::warn!("could not take {}: {err:#}", settings.record_shortcut);
    }
    app.state::<CurrentRecording>()
        .set_save_folder(settings.save_folder.map(PathBuf::from));
}

#[tauri::command]
pub(crate) fn get_settings(settings: State<'_, AppSettings>) -> Settings {
    settings.current()
}

#[tauri::command]
pub(crate) fn set_settings(app: AppHandle, settings: Settings) -> CmdResult {
    settings
        .record_shortcut
        .parse::<Shortcut>()
        .with_context(|| format!("{} isn't a shortcut", settings.record_shortcut))?;
    app.state::<AppSettings>().save(settings.clone())?;
    apply(&app);
    PageEvent::SettingsChanged(settings).send_to_each(&app, |_| true)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_settings(app: AppHandle) -> CmdResult {
    show_window(&app)?;
    Ok(())
}

pub(crate) fn show_window(app: &AppHandle) -> Result<()> {
    let window = match app.get_webview_window(WINDOW) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::default())
            .title("Settings")
            .inner_size(520.0, 640.0)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .theme(Some(Theme::Dark))
            .background_color(Color(14, 14, 16, 255))
            .center()
            .build()?,
    };
    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn choose_save_folder(app: AppHandle) -> CmdResult<Option<String>> {
    let chosen = run_blocking(move || {
        let folder = app
            .dialog()
            .file()
            .set_title("Save exports to")
            .blocking_pick_folder();
        folder
            .map(|folder| folder.into_path().map(|path| path.display().to_string()))
            .transpose()
            .context("that isn't a folder on this Mac")
    })
    .await?;
    Ok(chosen)
}

#[tauri::command]
pub(crate) async fn open_notices(app: AppHandle) -> CmdResult {
    let path = app
        .path()
        .resolve("THIRD-PARTY-NOTICES.txt", BaseDirectory::Resource)?;
    run_blocking(move || {
        let status = Command::new("/usr/bin/open")
            .arg("-t")
            .arg(&path)
            .status()?;
        ensure!(status.success(), "could not open {}", path.display());
        Ok(())
    })
    .await?;
    Ok(())
}

const REPO_URL: &str = "https://github.com/aidankmcalister/OpenTape";
const SCREEN_RECORDING_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

#[tauri::command]
pub(crate) async fn open_repo() -> CmdResult {
    Ok(open_url(REPO_URL).await?)
}

#[tauri::command]
pub(crate) fn has_screen_access() -> bool {
    cg::screen_capture_access::preflight()
}

#[tauri::command]
pub(crate) async fn open_screen_settings() -> CmdResult {
    cg::screen_capture_access::request();
    Ok(open_url(SCREEN_RECORDING_SETTINGS).await?)
}

async fn open_url(url: &'static str) -> Result<()> {
    run_blocking(move || {
        let status = Command::new("/usr/bin/open").arg(url).status()?;
        ensure!(status.success(), "could not open {url}");
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Modifiers;

    #[test]
    fn a_missing_or_broken_file_should_give_the_defaults() {
        let folder = std::env::temp_dir().join("opentape-test-settings");
        let _ = std::fs::remove_dir_all(&folder);
        let path = folder.join("settings.json");
        assert_eq!(read(&path), Settings::default());
        std::fs::create_dir_all(&folder).expect("the temp folder can be made");
        std::fs::write(&path, "{broken").expect("the temp file can be written");
        assert_eq!(read(&path), Settings::default());
        std::fs::write(&path, r#"{"saveFolder":"/tmp/x","deleteAfterDays":30}"#)
            .expect("the temp file can be written");
        assert_eq!(read(&path).save_folder.as_deref(), Some("/tmp/x"));
        assert!(read(&path).suggests_edits);
        assert!(read(&path).counts_down);
    }

    #[test]
    fn the_default_record_shortcut_should_be_option_shift_r() {
        let shortcut: Shortcut = Settings::default()
            .record_shortcut
            .parse()
            .expect("the default parses");
        assert_eq!(
            shortcut,
            Shortcut::new(
                Some(Modifiers::ALT | Modifiers::SHIFT),
                tauri_plugin_global_shortcut::Code::KeyR
            )
        );
    }

    #[test]
    fn saving_should_write_the_file_and_read_back() {
        let folder = std::env::temp_dir().join("opentape-test-settings-save");
        let _ = std::fs::remove_dir_all(&folder);
        let settings = AppSettings::load(folder.join("settings.json"));
        let chosen = Settings {
            save_folder: Some("/tmp/exports".into()),
            suggests_edits: false,
            ..Settings::default()
        };
        settings
            .save(chosen.clone())
            .expect("the folder is writable");
        assert_eq!(
            AppSettings::load(folder.join("settings.json")).current(),
            chosen
        );
    }
}
