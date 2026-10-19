//! The picker: one see-through overlay window per display, shown after a mode is chosen on the
//! record bar. Rust owns the picker session (mode, sources, a window pinned with Tab, the
//! display holding the Area box) and sends it whole whenever it changes. Overlays only draw it.

mod overlays;
mod session;
mod sources;
mod tracker;

use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard},
};

use anyhow::{Context, Result};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::capture::Target;
use crate::error::CmdResult;
use crate::geometry::Frame;
use crate::macos::keys::{self, Key};
use crate::macos::main_thread;
use crate::recording;
use crate::util::{lock, run_blocking};
use crate::windows::{bar, follow};
use overlays::{is_overlay, overlay_label, overlays, place_glass, put_away, show_overlay};
use session::{Mode, Session, Setup, apply_safe_tops, display_under, framing};
use sources::Sources;
use tracker::{cursor, follow_screen, stop_following_screen};

#[derive(Default)]
pub(crate) struct PickerState {
    session: Mutex<Option<Session>>,
}

impl PickerState {
    fn session(&self) -> MutexGuard<'_, Option<Session>> {
        lock(&self.session)
    }
}

#[tauri::command]
pub(crate) async fn open_picker(
    app: AppHandle,
    state: State<'_, PickerState>,
    mode: Mode,
) -> CmdResult {
    let mut sources = run_blocking(|| sources::list(&HashMap::new())).await?;
    let safe_tops = main_thread::run(&app, follow::safe_tops)?;
    apply_safe_tops(&mut sources.displays, &safe_tops);
    open(&app, &state, mode, sources)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn picker_setup(state: State<'_, PickerState>) -> CmdResult<Setup> {
    let session = state.session().clone().context("the picker isn't open")?;
    Ok(Setup {
        session,
        cursor: cursor(),
    })
}

#[tauri::command]
pub(crate) fn close_picker(app: AppHandle, state: State<'_, PickerState>) -> CmdResult {
    close(&app, &state, None)?;
    Ok(())
}

/// The picker's last step: closes the overlays and starts recording `target`. For an area or a
/// window, the overlay on its display stays as the frame: still dimming everything else, but
/// click-through and without controls, until the recording ends.
#[tauri::command]
pub(crate) fn record(app: AppHandle, state: State<'_, PickerState>, target: Target) -> CmdResult {
    let Some(framing) = state
        .session()
        .as_ref()
        .map(|session| framing(session, &target))
    else {
        // A second click on Record: the first already closed the picker, kept the frame and
        // started recording. Closing again here would take that frame down.
        return Ok(());
    };
    let frame = framing
        .as_ref()
        .and_then(|framing| app.get_webview_window(&overlay_label(framing.display_id)));
    let keep = frame.as_ref().map(|frame| frame.label().to_string());
    close(&app, &state, keep.as_deref())?;
    if let (Some(frame), Some(framing)) = (frame, framing) {
        let framed = frame
            .set_ignore_cursor_events(true)
            .and_then(|()| frame.emit_to(frame.label(), "picker-recording", framing.window));
        // Better no frame than one that blocks clicks on the whole display.
        if framed.is_err() {
            put_away(&frame);
        }
    }
    recording::start(app, target);
    Ok(())
}

/// Takes down a recording's frame once the recording ends.
pub(crate) fn close_frame(app: &AppHandle) {
    for overlay in overlays(app) {
        put_away(&overlay);
    }
}

#[tauri::command]
pub(crate) fn pin_window(app: AppHandle, window_id: u32) {
    update_session(&app, |session| session.pinned_window_id = Some(window_id));
}

#[tauri::command]
pub(crate) fn move_area(app: AppHandle, display_id: u32) {
    update_session(&app, |session| session.area_display_id = Some(display_id));
}

/// Puts the frosted glass under the overlay's capture bar, or hides it with `None`.
#[tauri::command]
pub(crate) fn place_overlay_glass(window: WebviewWindow, rect: Option<Frame>) -> CmdResult {
    place_glass(&window, rect)?;
    Ok(())
}

/// Esc closes the picker. Return and Tab go to the one overlay that should act on them: the
/// one holding the Area box, or else the one under the cursor.
pub(crate) fn on_key(app: &AppHandle, key: Key) {
    let state = app.state::<PickerState>();
    let name = match key {
        Key::Escape => {
            // A key has nowhere to show an error. The overlays are put away even when this fails.
            if let Err(err) = close(app, &state, None) {
                eprintln!("{err:#}");
            }
            return;
        }
        Key::Enter => "Enter",
        Key::Tab => "Tab",
        Key::Edit | Key::Copy | Key::Save => return,
    };
    let display_id = state
        .session()
        .as_ref()
        .and_then(|session| match session.mode {
            Mode::Area => session.area_display_id,
            Mode::Display | Mode::Window => display_under(&session.sources.displays, cursor()),
        });
    if let Some(display_id) = display_id {
        // Fails only once that overlay is gone, and then no one is there to press it.
        let _ = app.emit_to(overlay_label(display_id).as_str(), "picker-key", name);
    }
}

/// Shows an overlay on every display, or switches the mode if they're already showing.
fn open(app: &AppHandle, state: &PickerState, mode: Mode, sources: Sources) -> Result<()> {
    let displays = sources.displays.clone();
    let session = Session::new(mode, sources, cursor());
    // Checked and replaced under one lock, so two quick opens can't both show the overlays.
    let already_open = state.session().replace(session).is_some();
    if already_open {
        announce(app, state);
        return Ok(());
    }
    for display in &displays {
        show_overlay(app, display)?;
    }
    follow_screen(app.clone());
    if let Err(err) = keys::capture(app, keys::PICKER) {
        eprintln!("picker keys unavailable, use the bar instead: {err}");
    }
    Ok(())
}

/// Closes the picker, putting away every overlay but `keep`, the recording's frame.
fn close(app: &AppHandle, state: &PickerState, keep: Option<&str>) -> Result<()> {
    // Fails when the keys weren't taken, as when taking them failed. Nothing to give back then.
    let _ = keys::release(app, keys::PICKER);
    stop_following_screen();
    *state.session() = None;
    for overlay in overlays(app) {
        if Some(overlay.label()) != keep {
            put_away(&overlay);
        }
    }
    app.emit_to(bar::LABEL, "picker-closed", ())?;
    Ok(())
}

fn update_session(app: &AppHandle, change: impl FnOnce(&mut Session)) {
    let state = app.state::<PickerState>();
    if let Some(session) = state.session().as_mut() {
        change(session);
    }
    announce(app, &state);
}

fn announce(app: &AppHandle, state: &PickerState) {
    let session = state.session().clone();
    if let Some(session) = session {
        // Fails only once the overlays are gone, when no one is left to draw it.
        let _ = app.emit_filter("picker-session", session, is_overlay);
    }
}
