//! Native alerts, centered on the screen like Screen Studio's, instead of a sheet stuck to one of
//! this app's small windows. They wait for an answer, so call them off the main thread.

use objc2::MainThreadMarker;
use objc2_app_kit::NSApplication;
use tauri::AppHandle;
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

use super::main_thread;

const CANCEL: &str = "Cancel";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Choice {
    First,
    Second,
    Cancel,
}

/// A question with one or two answers, plus Cancel.
pub(crate) struct Alert<'a> {
    pub title: &'a str,
    pub message: &'a str,
    pub first: &'a str,
    pub second: Option<&'a str>,
}

/// Waits for an answer. On the main thread it answers Cancel straight away instead: the alert
/// needs the main thread to show, so waiting there would never end.
pub(crate) fn ask(app: &AppHandle, alert: Alert) -> Choice {
    if MainThreadMarker::new().is_some() {
        eprintln!("an alert was asked on the main thread, so it was cancelled");
        return Choice::Cancel;
    }
    // The bar and preview never activate the app, and an inactive app's alert opens behind
    // whatever you're using. If that fails, the alert still opens, just maybe behind.
    let activate = main_thread::run(app, |main_thread| {
        NSApplication::sharedApplication(main_thread).activate();
    });
    if let Err(err) = activate {
        eprintln!("could not bring the app forward for an alert: {err:#}");
    }
    let buttons = match alert.second {
        Some(second) => MessageDialogButtons::YesNoCancelCustom(
            alert.first.into(),
            second.into(),
            CANCEL.into(),
        ),
        None => MessageDialogButtons::OkCancelCustom(alert.first.into(), CANCEL.into()),
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
    fn choice_of_should_match_the_pressed_label() {
        let save = MessageDialogResult::Custom("Save and close".into());
        let delete = MessageDialogResult::Custom("Delete and close".into());
        let cancel = MessageDialogResult::Custom(CANCEL.into());
        let second = Some("Delete and close");
        assert_eq!(choice_of(&save, "Save and close", second), Choice::First);
        assert_eq!(choice_of(&delete, "Save and close", second), Choice::Second);
        assert_eq!(choice_of(&cancel, "Save and close", second), Choice::Cancel);
    }
}
