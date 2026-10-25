pub(crate) mod cursor;
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

pub(crate) fn catch<R>(job: impl FnOnce() -> R) -> Result<R> {
    exception::catch(AssertUnwindSafe(job)).map_err(|thrown| anyhow!("macOS refused: {thrown:?}"))
}

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
        let _ = done_tx.send(result);
    })?;
    done_rx
        .recv()
        .context("the app quit before macOS could do it")?
}

pub(crate) fn with_ns_window(
    window: &WebviewWindow,
    change: impl FnOnce(&NSWindow) + Send + 'static,
) -> tauri::Result<()> {
    let target = window.clone();
    window.run_on_main_thread(move || {
        let Ok(raw_ns_window) = target.ns_window() else {
            return;
        };
        let Some(ns_window) = (unsafe { raw_ns_window.cast::<NSWindow>().as_ref() }) else {
            return;
        };
        if let Err(err) = catch(|| change(ns_window)) {
            eprintln!("could not change the {} window: {err:#}", target.label());
        }
    })
}

pub(crate) fn float_panel(ns_window: &NSWindow, level: NSWindowLevel) {
    let panel_class: &AnyClass = FloatingPanel::class();
    let object: &AnyObject = ns_window.as_ref();
    if panel_class.instance_size() > object.class().instance_size() {
        eprintln!("the window can't become a panel, so it won't show over full-screen apps");
    } else {
        let window: *const AnyObject = object;
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
    #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ScreenRecorderPanel"]
    struct FloatingPanel;

    impl FloatingPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }
    }
);

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

pub(crate) async fn ask_in_background(app: &AppHandle, alert: Alert) -> Result<Choice> {
    let app = app.clone();
    let choice = tauri::async_runtime::spawn_blocking(move || ask(&app, alert)).await?;
    Ok(choice)
}

pub(crate) fn ask(app: &AppHandle, alert: Alert) -> Choice {
    if MainThreadMarker::new().is_some() {
        eprintln!("an alert was asked on the main thread, so it was canceled");
        return Choice::Cancel;
    }
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
