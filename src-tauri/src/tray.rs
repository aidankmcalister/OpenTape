use std::sync::Mutex;

use anyhow::Result;
use objc2::AllocAnyThread;
use objc2_app_kit::{
    NSImage, NSImageNameColumnViewTemplate, NSImageNameComputer, NSImageNameIconViewTemplate,
    NSImageNameListViewTemplate,
};
use objc2_foundation::NSData;
use tauri::image::Image;
use tauri::menu::{IconMenuItem, Menu, MenuItem, NativeIcon, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::current_recording::{Window, commands::show_again};
use crate::picker::Mode;
use crate::recording::{self, Phase};
use crate::util::lock;
use crate::windows::bar;
use crate::{PageEvent, settings};

pub(crate) struct Tray {
    new: IconMenuItem<Wry>,
    modes: [IconMenuItem<Wry>; 3],
    stop: MenuItem<Wry>,
    shortcut: Mutex<Option<Shortcut>>,
}

pub(crate) fn setup(app: &AppHandle) -> tauri::Result<()> {
    replace_native_icons();
    let item = |id: &str, text: &str, icon: NativeIcon| {
        IconMenuItem::with_id_and_native_icon(app, id, text, true, Some(icon), None::<&str>)
    };
    let new = item("new", "New recording", NativeIcon::Computer)?;
    let modes = [
        item("display", "Record display", NativeIcon::IconView)?,
        item("window", "Record window", NativeIcon::ListView)?,
        item("area", "Record area", NativeIcon::ColumnView)?,
    ];
    let stop = MenuItem::with_id(app, "stop", "Stop recording", false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &new,
            &PredefinedMenuItem::separator(app)?,
            &modes[0],
            &modes[1],
            &modes[2],
            &PredefinedMenuItem::separator(app)?,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit OpenTape", true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::new()
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("OpenTape")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "new" => new_recording(app, None),
            "display" => new_recording(app, Some(Mode::Display)),
            "window" => new_recording(app, Some(Mode::Window)),
            "area" => new_recording(app, Some(Mode::Area)),
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
        modes,
        stop,
        shortcut: Mutex::new(None),
    });
    Ok(())
}

pub(crate) fn show_phase(app: &AppHandle, phase: Phase) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    for item in std::iter::once(&tray.new).chain(&tray.modes) {
        let _ = item.set_enabled(phase == Phase::Idle);
    }
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

pub(crate) fn new_recording(app: &AppHandle, mode: Option<Mode>) {
    match show_again(app) {
        Ok(Window::Bar) => {
            let _ = PageEvent::NewRecording(mode).send_to(app, bar::LABEL);
        }
        Ok(Window::Preview | Window::Editor) => {}
        Err(err) => log::error!("could not show the app again: {err:#}"),
    }
}

fn replace_native_icons() {
    let icons = unsafe {
        [
            (
                NSImageNameComputer,
                &include_bytes!("../icons/tray.png")[..],
            ),
            (
                NSImageNameIconViewTemplate,
                &include_bytes!("../icons/menu/display.png")[..],
            ),
            (
                NSImageNameListViewTemplate,
                &include_bytes!("../icons/menu/window.png")[..],
            ),
            (
                NSImageNameColumnViewTemplate,
                &include_bytes!("../icons/menu/area.png")[..],
            ),
        ]
    };
    for (name, png) in icons {
        let Some(image) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(png)) else {
            continue;
        };
        image.setTemplate(true);
        image.setName(Some(name));
        std::mem::forget(image);
    }
}
