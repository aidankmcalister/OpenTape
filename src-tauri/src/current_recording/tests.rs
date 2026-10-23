use std::cell::RefCell;

use super::*;

struct FakeShell {
    answer: Choice,
    asked: RefCell<Vec<&'static str>>,
    switches: RefCell<Vec<(Window, Window)>>,
}

impl FakeShell {
    fn answering(answer: Choice) -> Self {
        Self {
            answer,
            asked: RefCell::default(),
            switches: RefCell::default(),
        }
    }

    fn last_switch(&self) -> (Window, Window) {
        *self.switches.borrow().last().expect("something switched")
    }
}

impl Shell for FakeShell {
    fn ask(&self, alert: Alert) -> Choice {
        self.asked.borrow_mut().push(alert.title);
        self.answer
    }

    fn switch(&self, from: Window, to: Window, _: Option<&ShownRecording>) -> Result<()> {
        self.switches.borrow_mut().push((from, to));
        Ok(())
    }
}

fn keeping_one(test: &str, shell: &FakeShell) -> (CurrentRecording, PathBuf) {
    let root = std::env::temp_dir().join(format!("screen-recorder-test-{test}"));
    let _ = std::fs::remove_dir_all(&root);
    let current = CurrentRecording::new(Folders {
        storage: root.join("recordings"),
        downloads: root.join("Downloads"),
        copies: root.join("copies"),
    });
    let folder = current.new_folder();
    std::fs::create_dir_all(&folder).expect("the temp folder can be made");
    let video = folder.join("recording.mov");
    std::fs::write(&video, b"").expect("the temp video can be written");
    current.keep(shell, video).expect("nothing else is open");
    (current, folder)
}

const SAVE_OR_DELETE: &str = "Save this recording before closing, or delete it?";

#[test]
fn keep_should_show_the_preview_and_refuse_a_second_recording() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("keep", &shell);
    assert_eq!(*shell.switches.borrow(), [(Window::Bar, Window::Preview)]);
    let name = current.shown().expect("it's kept").name;
    assert_eq!(
        folder.file_name().and_then(|name| name.to_str()),
        Some(&*name)
    );
    let second = current.keep(&shell, folder.join("other.mov"));
    assert!(second.is_err());
    assert_eq!(current.shown().expect("still kept").name, name);
    assert_eq!(shell.switches.borrow().len(), 1);
}

#[test]
fn closing_unsaved_should_ask_and_cancel_should_keep_it() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("cancel", &shell);
    current.close(&shell).expect("canceling is fine");
    assert_eq!(*shell.asked.borrow(), [SAVE_OR_DELETE]);
    assert_eq!(shell.last_switch(), (Window::Bar, Window::Preview));
    assert!(folder.exists());
    assert!(current.shown().is_some());
}

#[test]
fn closing_unsaved_with_delete_should_bring_the_bar_back_and_delete() {
    let shell = FakeShell::answering(Choice::Second);
    let (current, folder) = keeping_one("delete", &shell);
    current.close(&shell).expect("closes");
    assert_eq!(*shell.asked.borrow(), [SAVE_OR_DELETE]);
    assert_eq!(shell.last_switch(), (Window::Preview, Window::Bar));
    assert!(!folder.exists());
    assert!(current.shown().is_none());
}

#[test]
fn closing_saved_should_skip_the_alert_and_delete() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("saved", &shell);
    let saved_to = folder.with_file_name("saved.mp4");
    std::fs::write(&saved_to, b"").expect("the temp export can be written");
    lock(&current.kept).as_mut().expect("kept").saved_to = Some(saved_to);
    current.close(&shell).expect("closes");
    assert!(shell.asked.borrow().is_empty());
    assert!(!folder.exists());
}

#[test]
fn closing_from_the_editor_should_ask_its_own_alert_and_never_save() {
    let shell = FakeShell::answering(Choice::First);
    let (current, folder) = keeping_one("editor", &shell);
    current.edit(&shell).expect("edits");
    assert_eq!(shell.last_switch(), (Window::Preview, Window::Editor));
    current.close(&shell).expect("closes");
    assert_eq!(*shell.asked.borrow(), ["Delete this recording and close?"]);
    assert_eq!(shell.last_switch(), (Window::Editor, Window::Bar));
    assert!(!folder.exists());
    assert!(!current.folders.downloads.exists());
}

#[test]
fn a_failed_delete_should_be_reported_after_the_bar_comes_back() {
    let shell = FakeShell::answering(Choice::Second);
    let (current, folder) = keeping_one("failed-delete", &shell);
    std::fs::remove_dir_all(&folder).expect("the temp folder can be removed");
    let err = current
        .close(&shell)
        .expect_err("there's nothing to delete");
    assert!(format!("{err:#}").starts_with("could not delete"));
    assert_eq!(shell.last_switch(), (Window::Preview, Window::Bar));
    assert!(current.shown().is_none());
}

#[test]
fn names_should_read_like_macos_screen_recordings() {
    let started = chrono::NaiveDate::from_ymd_opt(2026, 10, 16)
        .and_then(|day| day.and_hms_opt(7, 41, 28))
        .expect("a real time");
    let name = started.format(NAME_FORMAT).to_string();
    assert_eq!(name, "2026-10-16 07.41.28");
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, _) = keeping_one("names", &shell);
    lock(&current.kept).as_mut().expect("kept").name = name;
    let (_, export_name) = current.video().expect("kept");
    assert_eq!(export_name, "Screen Recording 2026-10-16 at 07.41.28");
}

#[test]
fn file_names_should_be_safe_and_numbered_like_finder_when_taken() {
    assert_eq!(file_name("a/b: c", "gif"), "a-b- c.gif");
    let folder = Path::new("/Downloads");
    let taken = [folder.join("Clip.mp4"), folder.join("Clip 2.mp4")];
    let path = free_path(folder, "Clip", "mp4", |path| {
        taken.iter().any(|t| t == path)
    });
    assert_eq!(path, folder.join("Clip 3.mp4"));
    assert_eq!(
        free_path(folder, "New", "mp4", |_| false),
        folder.join("New.mp4")
    );
}
