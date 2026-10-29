use std::sync::Mutex;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tauri::async_runtime::{self, JoinHandle};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use ts_rs::TS;

use crate::current_recording::commands::show_again;
use crate::macos::{self, Alert};
use crate::settings::{self, REPO_URL};
use crate::util::{CmdResult, lock};
use crate::{PageEvent, relaunch, tray};

#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[serde(tag = "state", rename_all = "camelCase")]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum UpdateStatus {
    UpToDate,
    #[default]
    Checking,
    Available {
        version: String,
        notes: String,
    },
    Downloading {
        version: String,
        #[ts(type = "number")]
        downloaded: u64,
        #[ts(type = "number")]
        total: u64,
    },
    Ready {
        version: String,
    },
    Failed {
        version: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) struct MenuChoice {
    pub text: String,
    pub enabled: bool,
}

impl From<&UpdateStatus> for MenuChoice {
    fn from(status: &UpdateStatus) -> Self {
        let (text, enabled) = match status {
            UpdateStatus::UpToDate | UpdateStatus::Failed { version: None } => {
                ("Check for Updates…".to_owned(), true)
            }
            UpdateStatus::Checking => ("Checking for Updates…".to_owned(), false),
            UpdateStatus::Available { version, .. } => (format!("Update to {version}…"), true),
            UpdateStatus::Downloading { version, .. } => (format!("Downloading {version}…"), false),
            UpdateStatus::Ready { .. } => ("Restart to Update".to_owned(), true),
            UpdateStatus::Failed { version: Some(_) } => ("Try Updating Again".to_owned(), true),
        };
        Self { text, enabled }
    }
}

const UP_TO_DATE: Alert = Alert {
    title: "OpenTape is up to date",
    message: "You have the newest version.",
    first: "OK",
    second: None,
};

const COULD_NOT_CHECK: Alert = Alert {
    title: "Could not check for updates",
    message: "Check your connection and try again.",
    first: "OK",
    second: None,
};

const CHECK_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
pub(crate) struct UpdateState(Mutex<Found>);

#[derive(Default)]
struct Found {
    status: UpdateStatus,
    update: Option<Update>,
    download: Option<JoinHandle<()>>,
}

fn available(update: &Update) -> UpdateStatus {
    UpdateStatus::Available {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
    }
}

fn announce(app: &AppHandle, status: UpdateStatus) {
    lock(&app.state::<UpdateState>().0).status = status.clone();
    tray::show_update(app, &MenuChoice::from(&status));
    let _ = PageEvent::UpdateStatus(status).send_to_each(app, |_| true);
}

async fn check(app: &AppHandle) -> Result<()> {
    announce(app, UpdateStatus::Checking);
    let update = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()?
        .check()
        .await?;
    let status = update.as_ref().map_or(UpdateStatus::UpToDate, available);
    lock(&app.state::<UpdateState>().0).update = update;
    announce(app, status);
    Ok(())
}

pub(crate) fn check_quietly(app: &AppHandle) {
    let app = app.clone();
    async_runtime::spawn(async move {
        if let Err(err) = check(&app).await {
            log::warn!("could not check for an update: {err:#}");
            announce(&app, UpdateStatus::UpToDate);
        }
    });
}

async fn download(app: &AppHandle, update: &Update) -> Result<()> {
    let version = update.version.clone();
    let mut downloaded = 0;
    let mut shown_percent = None;
    announce(
        app,
        UpdateStatus::Downloading {
            version: version.clone(),
            downloaded,
            total: 0,
        },
    );
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let total = total.unwrap_or(0);
                let percent = downloaded * 100 / total.max(1);
                if shown_percent != Some(percent) {
                    shown_percent = Some(percent);
                    announce(
                        app,
                        UpdateStatus::Downloading {
                            version: version.clone(),
                            downloaded,
                            total,
                        },
                    );
                }
            },
            || {},
        )
        .await?;
    if cfg!(debug_assertions) {
        bail!("a dev build can't install updates, so this one stops after downloading");
    }
    update.install(bytes)?;
    announce(app, UpdateStatus::Ready { version });
    Ok(())
}

#[tauri::command]
pub(crate) fn update_status(state: State<'_, UpdateState>) -> UpdateStatus {
    lock(&state.0).status.clone()
}

#[tauri::command]
pub(crate) async fn check_for_update(app: AppHandle) -> CmdResult {
    if let Err(err) = check(&app).await {
        announce(&app, UpdateStatus::Failed { version: None });
        return Err(err.into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn install_update(app: AppHandle) -> CmdResult {
    install(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn update_menu(state: State<'_, UpdateState>) -> MenuChoice {
    MenuChoice::from(&lock(&state.0).status)
}

#[tauri::command]
pub(crate) fn choose_update_menu(app: AppHandle) {
    choose_from_menu(&app);
}

pub(crate) fn choose_from_menu(app: &AppHandle) {
    let result = match update_status(app.state()) {
        UpdateStatus::Available { .. } | UpdateStatus::Failed { version: Some(_) } => install(app),
        UpdateStatus::Ready { .. } => {
            relaunch(app.clone()).map_err(|err| anyhow::anyhow!("{err:?}"))
        }
        UpdateStatus::UpToDate | UpdateStatus::Failed { version: None } => {
            async_runtime::spawn(check_and_tell(app.clone()));
            Ok(())
        }
        UpdateStatus::Checking | UpdateStatus::Downloading { .. } => Ok(()),
    };
    if let Err(err) = result {
        log::warn!("could not update from the menu: {err:#}");
    }
}

async fn check_and_tell(app: AppHandle) {
    let alert = match check(&app).await {
        Err(err) => {
            log::warn!("could not check for an update: {err:#}");
            announce(&app, UpdateStatus::Failed { version: None });
            COULD_NOT_CHECK
        }
        Ok(()) if update_status(app.state()) == UpdateStatus::UpToDate => UP_TO_DATE,
        Ok(()) => {
            if let Err(err) = show_again(&app) {
                log::warn!("could not show the update: {err:#}");
            }
            return;
        }
    };
    if let Err(err) = macos::ask_in_background(&app, alert).await {
        log::warn!("could not show the update alert: {err:#}");
    }
}

fn install(app: &AppHandle) -> Result<()> {
    let state = app.state::<UpdateState>();
    let mut found = lock(&state.0);
    let update = found
        .update
        .clone()
        .context("there's no update to install")?;
    let task_app = app.clone();
    found.download = Some(async_runtime::spawn(async move {
        if let Err(err) = download(&task_app, &update).await {
            log::warn!("could not install {}: {err:#}", update.version);
            let version = Some(update.version.clone());
            announce(&task_app, UpdateStatus::Failed { version });
        }
    }));
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_update(app: AppHandle, state: State<'_, UpdateState>) {
    let status = {
        let mut found = lock(&state.0);
        if let Some(download) = found.download.take() {
            download.abort();
        }
        found.update.as_ref().map(available)
    };
    if let Some(status) = status {
        announce(&app, status);
    }
}

#[tauri::command]
pub(crate) async fn open_release_notes(app: AppHandle) -> CmdResult {
    let version = lock(&app.state::<UpdateState>().0)
        .update
        .as_ref()
        .map(|update| update.version.clone())
        .context("there's no update")?;
    Ok(settings::open_url(format!("{REPO_URL}/releases/tag/v{version}")).await?)
}
