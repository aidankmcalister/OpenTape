use std::sync::Mutex;

use anyhow::Result;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::current_recording::{Window, commands::show_again};
use crate::recording::{self, Phase};
use crate::util::lock;
use crate::windows::bar;
use crate::{PageEvent, settings};

pub(crate) struct Tray {
    new: MenuItem<Wry>,
    stop: MenuItem<Wry>,
    shortcut: Mutex<Option<Shortcut>>,
}

pub(crate) fn setup(app: &AppHandle) -> tauri::Result<()> {
    let new = MenuItem::with_id(app, "new", "New recording", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop recording", false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &new,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit screen-recorder", true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::new()
        .icon(record_icon())
        .icon_as_template(true)
        .tooltip("screen-recorder")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "new" => new_recording(app),
            "stop" => recording::stop_soon(app),
            "settings" => {
                if let Err(err) = settings::show_window(app) {
                    log::error!("could not open Settings: {err:#}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    app.manage(Tray {
        new,
        stop,
        shortcut: Mutex::new(None),
    });
    Ok(())
}

pub(crate) fn show_phase(app: &AppHandle, phase: Phase) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    let _ = tray.new.set_enabled(phase == Phase::Idle);
    let _ = tray
        .stop
        .set_enabled(matches!(phase, Phase::Recording | Phase::Paused));
}

pub(crate) fn set_record_shortcut(app: &AppHandle, text: &str) -> Result<()> {
    let shortcut: Shortcut = text.parse()?;
    let tray = app.state::<Tray>();
    let mut taken = lock(&tray.shortcut);
    if *taken == Some(shortcut) {
        return Ok(());
    }
    let keys = app.global_shortcut();
    if let Some(old) = taken.take() {
        keys.unregister(old)?;
    }
    keys.on_shortcut(shortcut, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            recording::start_or_stop(app);
        }
    })?;
    *taken = Some(shortcut);
    tray.new.set_accelerator(Some(text))?;
    Ok(())
}

pub(crate) fn new_recording(app: &AppHandle) {
    match show_again(app) {
        Ok(Window::Bar) => {
            let _ = PageEvent::NewRecording.send_to(app, bar::LABEL);
        }
        Ok(Window::Preview | Window::Editor) => {}
        Err(err) => log::error!("could not show the app again: {err:#}"),
    }
}

fn record_icon() -> Image<'static> {
    const SIZE: u32 = 36;
    let center = f64::from(SIZE) / 2.0;
    let rgba = (0..SIZE * SIZE)
        .flat_map(|index| {
            let x = f64::from(index % SIZE) + 0.5 - center;
            let y = f64::from(index / SIZE) + 0.5 - center;
            let inside = |radius: f64| (radius - x.hypot(y) + 0.5).clamp(0.0, 1.0);
            let ink = inside(7.0).max(inside(16.0) - inside(13.5));
            [0, 0, 0, (ink * 255.0).round() as u8]
        })
        .collect();
    Image::new_owned(rgba, SIZE, SIZE)
}
