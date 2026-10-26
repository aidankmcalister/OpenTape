use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, path::BaseDirectory};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::current_recording::CurrentRecording;
use crate::util::{CmdResult, lock, run_blocking};

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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            save_folder: None,
            export: None,
            appearance: None,
            suggests_edits: true,
        }
    }
}

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
    app.state::<CurrentRecording>()
        .set_save_folder(settings.save_folder.map(PathBuf::from));
}

#[tauri::command]
pub(crate) fn get_settings(settings: State<'_, AppSettings>) -> Settings {
    settings.current()
}

#[tauri::command]
pub(crate) fn set_settings(app: AppHandle, settings: Settings) -> CmdResult {
    app.state::<AppSettings>().save(settings)?;
    apply(&app);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_or_broken_file_should_give_the_defaults() {
        let folder = std::env::temp_dir().join("screen-recorder-test-settings");
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
    }

    #[test]
    fn saving_should_write_the_file_and_read_back() {
        let folder = std::env::temp_dir().join("screen-recorder-test-settings-save");
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
