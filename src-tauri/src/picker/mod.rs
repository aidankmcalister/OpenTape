mod overlays;
mod sources;

use std::{sync::Mutex, time::Duration};

use anyhow::Result;
use cidre::cg;
use objc2_app_kit::NSCursor;
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, Shortcut};
use ts_rs::TS;

use self::overlays::{
    is_overlay, overlay_label, overlays, place_glass, prepare_overlays, put_away, show_overlay,
};
pub(crate) use self::sources::Session;
use self::sources::{Mode, Setup, apply_safe_tops, framing};
use crate::capture::Target;
use crate::geometry::{Frame, Point};
use crate::util::{CmdResult, Poller, lock, run_blocking};
use crate::windows::{bar, safe_tops};
use crate::{KeySet, PageEvent, macos, recording};

#[derive(Default)]
pub(crate) struct PickerState(Mutex<Option<Session>>);

static SCREEN_LOOP: Poller = Poller::new();

#[tauri::command]
pub(crate) async fn open_picker(
    app: AppHandle,
    state: State<'_, PickerState>,
    mode: Mode,
) -> CmdResult {
    let mut sources = run_blocking(sources::list).await?;
    let safe_tops = macos::run_on_main_thread(&app, safe_tops)?;
    apply_safe_tops(&mut sources.displays, &safe_tops);
    let displays = sources.displays.clone();
    let session = Session::new(mode, sources, cursor_position());
    // One lock for the check and the replace, so two quick opens can't both show the overlays.
    let already_open = lock(&state.0).replace(session).is_some();
    if already_open {
        announce_session(&app);
        return Ok(());
    }
    for display in &displays {
        show_overlay(&app, display)?;
    }
    // Overlays reloaded while hidden asked for the session and found none, so hand it to them.
    announce_session(&app);
    watch_screen(app.clone());
    if let Err(err) = PickerKey::take(&app) {
        eprintln!("could not take the picker keys, so only the bar works: {err}");
    }
    Ok(())
}

pub(crate) fn prepare(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(sources) = run_blocking(sources::list).await else {
            return;
        };
        if let Err(err) = prepare_overlays(&app, &sources.displays) {
            eprintln!("could not make the picker overlays ahead of time: {err:#}");
        }
    });
}

#[tauri::command]
pub(crate) fn picker_setup(state: State<'_, PickerState>) -> Option<Setup> {
    let session = lock(&state.0).clone()?;
    Some(Setup {
        session,
        cursor: cursor_position(),
    })
}

#[tauri::command]
pub(crate) fn close_picker(app: AppHandle) -> CmdResult {
    close(&app, None)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn record(app: AppHandle, state: State<'_, PickerState>, target: Target) -> CmdResult {
    let Some(framing) = lock(&state.0)
        .as_ref()
        .map(|session| framing(session, &target))
    else {
        // A second Record click: closing again would take down the frame the first one kept.
        return Ok(());
    };
    let frame_overlay = framing
        .as_ref()
        .and_then(|framing| app.get_webview_window(&overlay_label(framing.display_id)));
    close(&app, frame_overlay.as_ref().map(|overlay| overlay.label()))?;
    if let (Some(overlay), Some(framing)) = (frame_overlay, framing) {
        let framed = overlay.set_ignore_cursor_events(true).and_then(|()| {
            PageEvent::PickerRecording(framing.window).send_to(&app, overlay.label())
        });
        // Better no frame than one that blocks clicks on the whole display.
        if framed.is_err() {
            put_away(&overlay);
        }
    }
    recording::start(app, target);
    Ok(())
}

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

#[tauri::command]
pub(crate) fn place_overlay_glass(window: WebviewWindow, rect: Option<Frame>) -> CmdResult {
    place_glass(&window, rect)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "bindings.ts")]
pub(crate) enum PickerKey {
    #[ts(skip)]
    Escape,
    Enter,
    Tab,
}

impl KeySet for PickerKey {
    const KEYS: [Self; 3] = [Self::Escape, Self::Enter, Self::Tab];

    fn shortcut(self) -> Shortcut {
        let code = match self {
            Self::Escape => Code::Escape,
            Self::Enter => Code::Enter,
            Self::Tab => Code::Tab,
        };
        Shortcut::new(None, code)
    }

    fn press(self, app: &AppHandle) {
        if self == Self::Escape {
            if let Err(err) = close(app, None) {
                eprintln!("{err:#}");
            }
            return;
        }
        // A recording's frame is an overlay too, and must not hear keys once the picker is closed.
        if lock(&app.state::<PickerState>().0).is_none() {
            return;
        }
        let _ = PageEvent::PickerKey(self).send_to_each(app, is_overlay);
    }
}

fn close(app: &AppHandle, keep: Option<&str>) -> Result<()> {
    let _ = PickerKey::give_back(app);
    SCREEN_LOOP.stop();
    *lock(&app.state::<PickerState>().0) = None;
    for overlay in overlays(app) {
        if Some(overlay.label()) != keep {
            put_away(&overlay);
        }
    }
    PageEvent::PickerClosed.send_to(app, bar::LABEL)?;
    Ok(())
}

fn update_session(app: &AppHandle, change: impl FnOnce(&mut Session)) {
    if let Some(session) = lock(&app.state::<PickerState>().0).as_mut() {
        change(session);
    }
    announce_session(app);
}

fn announce_session(app: &AppHandle) {
    let session = lock(&app.state::<PickerState>().0).clone();
    if let Some(session) = session {
        let _ = PageEvent::PickerSession(session).send_to_each(app, is_overlay);
    }
}

fn cursor_position() -> Option<Point> {
    let location = cg::Event::with_src(None)?.location();
    Some(Point {
        x: location.x,
        y: location.y,
    })
}

/// Unfocused macOS windows get no hover events, so Rust reports the cursor to the overlays.
fn watch_screen(app: AppHandle) {
    let mut last_cursor = None;
    let mut last_window_list = sources::stacking_order();
    let mut ticks: u32 = 0;
    SCREEN_LOOP.start(Duration::from_millis(16), move || {
        if let Some(point) = cursor_position()
            && !is_same_spot(last_cursor, point)
        {
            last_cursor = Some(point);
            let _ = PageEvent::PickerCursor(point).send_to_each(&app, is_overlay);
            // The overlays never become key, so macOS never resets the cursor over them.
            let _ = app.run_on_main_thread(|| NSCursor::arrowCursor().set());
            let is_pinned = lock(&app.state::<PickerState>().0)
                .as_ref()
                .is_some_and(|session| session.pinned_window_id.is_some());
            if is_pinned {
                update_session(&app, |session| session.pinned_window_id = None);
            }
        }
        ticks = ticks.wrapping_add(1);
        if ticks.is_multiple_of(15) {
            let window_list = sources::stacking_order();
            if window_list != last_window_list {
                last_window_list = window_list;
                refresh_sources(&app);
            }
        }
        true
    });
}

fn refresh_sources(app: &AppHandle) {
    let Ok(mut sources) = sources::list() else {
        return;
    };
    update_session(app, |session| {
        for display in &mut sources.displays {
            let known = session
                .sources
                .displays
                .iter()
                .find(|known| known.id == display.id);
            if let Some(known) = known {
                display.safe_top = known.safe_top;
            }
        }
        session.sources = sources;
    });
}

fn is_same_spot(last: Option<Point>, point: Point) -> bool {
    last.is_some_and(|last| (last.x - point.x).abs() < 1.0 && (last.y - point.y).abs() < 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_same_spot_should_ignore_moves_under_a_point() {
        let last = Some(Point { x: 10.0, y: 10.0 });
        let cases = [
            (10.4, 9.8, true),
            (9.1, 10.9, true),
            (11.0, 10.0, false),
            (10.0, 9.0, false),
            (12.0, 10.0, false),
        ];
        for (x, y, same) in cases {
            assert_eq!(is_same_spot(last, Point { x, y }), same, "({x}, {y})");
        }
        assert!(!is_same_spot(None, Point { x: 10.0, y: 10.0 }));
    }
}
