//! Thin wrappers over macOS (AppKit) features Tauri doesn't cover: running AppKit code on the
//! main thread, floating panels, native alerts and the clipboard. The frosted glass lives in
//! `glass`.

pub(crate) mod glass;

use std::{panic::AssertUnwindSafe, path::PathBuf, sync::mpsc};

use anyhow::{Context, Result, anyhow, ensure};
use objc2::{
    ClassType, MainThreadMarker, MainThreadOnly, define_class, exception, ffi,
    runtime::{AnyClass, AnyObject, ProtocolObject},
};
use objc2_app_kit::{
    NSApplication, NSPanel, NSPasteboard, NSResponder, NSWindow, NSWindowCollectionBehavior,
    NSWindowLevel, NSWindowStyleMask,
};
use objc2_foundation::{NSArray, NSObject, NSString, NSURL};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

/// Runs `job`, turning an Objective-C exception it throws into an error. Works on any thread.
/// Every AppKit call goes through here, usually by way of `run_on_main_thread` or
/// `with_ns_window`.
///
/// AppKit reports misuse by throwing Objective-C exceptions. Rust can't unwind through them, so
/// one that isn't caught aborts the app.
pub(crate) fn catch<R>(job: impl FnOnce() -> R) -> Result<R> {
    exception::catch(AssertUnwindSafe(job)).map_err(|thrown| anyhow!("macOS refused: {thrown:?}"))
}

/// Runs `job` on the main thread, as AppKit requires, waits for it, and returns what it
/// returned. Called on the main thread, it runs `job` right away, since queueing it there and
/// waiting would block the thread that has to run it.
pub(crate) fn run_on_main_thread<R: Send + 'static>(
    app: &AppHandle,
    job: impl FnOnce(MainThreadMarker) -> R + Send + 'static,
) -> Result<R> {
    if let Some(main_thread) = MainThreadMarker::new() {
        return catch(|| job(main_thread));
    }
    let (done_tx, done_rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let result = MainThreadMarker::new()
            .context("Tauri ran a main-thread job elsewhere")
            .and_then(|main_thread| catch(|| job(main_thread)));
        // Can't fail: `run_on_main_thread` is waiting on the other end.
        let _ = done_tx.send(result);
    })?;
    // An error here means the app quit before the job ran, which dropped it.
    done_rx
        .recv()
        .context("the app quit before macOS could do it")?
}

/// Runs `change` with the window's `NSWindow`, on the main thread as AppKit requires.
///
/// It doesn't wait for `change` to run. An Objective-C exception it throws is caught and logged:
/// nothing is waiting to hear about it, and the next change tries again.
pub(crate) fn with_ns_window(
    window: &WebviewWindow,
    change: impl FnOnce(&NSWindow) + Send + 'static,
) -> tauri::Result<()> {
    let target = window.clone();
    window.run_on_main_thread(move || {
        // Fails only once the window is gone, and then there's nothing to change.
        let Ok(raw_ns_window) = target.ns_window() else {
            return;
        };
        // SAFETY: Tauri hands back this window's NSWindow, or null, which `as_ref` turns into
        // `None`. This closure runs on the main thread, where AppKit allows NSWindow calls and
        // where windows are destroyed, so the window outlives the borrow, which ends with it.
        let Some(ns_window) = (unsafe { raw_ns_window.cast::<NSWindow>().as_ref() }) else {
            return;
        };
        if let Err(err) = catch(|| change(ns_window)) {
            eprintln!("could not change the {} window: {err:#}", target.label());
        }
    })
}

/// Shows the window on every space at `level`, as a panel so it can also join other apps'
/// full-screen spaces. Only for windows that live as long as the app: closing a panel crashes.
pub(crate) fn float_panel(ns_window: &NSWindow, level: NSWindowLevel) {
    // Swaps the window's class for `FloatingPanel` in place, making it a non-activating panel:
    // the kind of window macOS lets float over other apps' full-screen spaces while the app keeps
    // its Dock icon. Electron's `type: 'panel'` and tauri-nspanel make the same swap.
    let panel_class: &AnyClass = FloatingPanel::class();
    let object: &AnyObject = ns_window.as_ref();
    // A class whose objects are bigger than this one would read past the end of its memory.
    if panel_class.instance_size() > object.class().instance_size() {
        eprintln!("the window can't become a panel, so it won't show over full-screen apps");
    } else {
        let window: *const AnyObject = object;
        // SAFETY: the window is a live NSWindow on the main thread. `FloatingPanel` subclasses
        // NSWindow, adds no state, and fits in the window's memory (checked above). Tao's window
        // class adds only a `focusable` flag, which nothing reads once Tao's methods are swapped
        // out.
        unsafe { ffi::object_setClass(window.cast_mut(), panel_class) };
        ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    }
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setHidesOnDeactivate(false);
    ns_window.setLevel(level);
}

define_class!(
    // SAFETY: NSPanel has no subclassing requirements, and this class adds no instance
    // variables and no `Drop`, so `float_panel` can swap it onto an existing window.
    #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ScreenRecorderPanel"]
    struct FloatingPanel;

    impl FloatingPanel {
        /// Borderless panels refuse keyboard focus by default, but the Area fields need it.
        // SAFETY: the signature matches `-[NSWindow canBecomeKeyWindow]`, which returns a BOOL.
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }
    }
);

/// Puts the file at `path` on the clipboard the way Finder's Copy does, so it pastes as the file
/// itself.
pub(crate) fn put_file_on_clipboard(app: &AppHandle, path: PathBuf) -> Result<()> {
    run_on_main_thread(app, move |_| {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.display().to_string()));
        let objects = NSArray::from_retained_slice(&[ProtocolObject::from_retained(url)]);
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();
        ensure!(
            pasteboard.writeObjects(&objects),
            "could not put the recording on the clipboard"
        );
        Ok(())
    })?
}

/// A question with one or two answers, plus Cancel, centered on the screen like Screen
/// Studio's instead of a sheet stuck to one of this app's small windows.
pub(crate) struct Alert {
    pub title: &'static str,
    pub message: &'static str,
    pub first: &'static str,
    pub second: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Choice {
    First,
    Second,
    Cancel,
}

/// Asks from async code: waits for the answer on a background thread.
pub(crate) async fn ask_in_background(app: &AppHandle, alert: Alert) -> Result<Choice> {
    let app = app.clone();
    let choice = tauri::async_runtime::spawn_blocking(move || ask(&app, alert)).await?;
    Ok(choice)
}

/// Waits for an answer. On the main thread it answers Cancel straight away instead: the alert
/// needs the main thread to show, so waiting there would never end.
pub(crate) fn ask(app: &AppHandle, alert: Alert) -> Choice {
    if MainThreadMarker::new().is_some() {
        eprintln!("an alert was asked on the main thread, so it was cancelled");
        return Choice::Cancel;
    }
    // The bar and preview never activate the app, and an inactive app's alert opens behind
    // whatever you're using. If activating fails, the alert still opens, maybe behind others.
    let activate = run_on_main_thread(app, |main_thread| {
        NSApplication::sharedApplication(main_thread).activate();
    });
    if let Err(err) = activate {
        eprintln!("could not bring the app forward for an alert: {err:#}");
    }
    let buttons = match alert.second {
        Some(second) => MessageDialogButtons::YesNoCancelCustom(
            alert.first.into(),
            second.into(),
            "Cancel".into(),
        ),
        None => MessageDialogButtons::OkCancelCustom(alert.first.into(), "Cancel".into()),
    };
    let result = app
        .dialog()
        .message(alert.message)
        .title(alert.title)
        .kind(MessageDialogKind::Warning)
        .buttons(buttons)
        .blocking_show_with_result();
    choice_of(&result, alert.first, alert.second)
}

fn choice_of(result: &MessageDialogResult, first: &str, second: Option<&str>) -> Choice {
    match result {
        MessageDialogResult::Custom(label) if label == first => Choice::First,
        MessageDialogResult::Custom(label) if Some(label.as_str()) == second => Choice::Second,
        MessageDialogResult::Yes | MessageDialogResult::Ok => Choice::First,
        MessageDialogResult::No => Choice::Second,
        _ => Choice::Cancel,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floating_panel_should_fit_in_a_plain_window() {
        let panel = FloatingPanel::class().instance_size();
        assert!(panel <= NSWindow::class().instance_size());
    }

    #[test]
    fn choice_of_should_match_the_pressed_label() {
        let second = Some("Delete and close");
        for (pressed, choice) in [
            ("Save and close", Choice::First),
            ("Delete and close", Choice::Second),
            ("Cancel", Choice::Cancel),
        ] {
            let result = MessageDialogResult::Custom(pressed.into());
            assert_eq!(choice_of(&result, "Save and close", second), choice);
        }
    }
}
