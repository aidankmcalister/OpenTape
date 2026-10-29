use std::cell::RefCell;

use super::*;

struct FakeShell {
    answer: Choice,
    asked: RefCell<Vec<&'static str>>,
    switches: RefCell<Vec<(Window, Window)>>,
    exports: RefCell<usize>,
}

impl FakeShell {
    fn answering(answer: Choice) -> Self {
        Self {
            answer,
            asked: RefCell::default(),
            switches: RefCell::default(),
            exports: RefCell::default(),
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

    fn export_and_close(&self) -> Result<()> {
        *self.exports.borrow_mut() += 1;
        Ok(())
    }

    fn switch(&self, from: Window, to: Window, _: Option<&ShownRecording>) -> Result<()> {
        self.switches.borrow_mut().push((from, to));
        Ok(())
    }

    fn offer_restore(&self, _: bool) {}
}

fn keeping_one(test: &str, shell: &FakeShell) -> (CurrentRecording, PathBuf) {
    let root = std::env::temp_dir().join(format!("opentape-test-{test}"));
    let _ = std::fs::remove_dir_all(&root);
    let current = CurrentRecording::new(Folders {
        storage: root.join("recordings"),
        downloads: root.join("Downloads"),
        copies: root.join("copies"),
    });
    let folder = current.new_folder().expect("the temp folder can be made");
    let video = folder.join("recording.mov");
    std::fs::write(&video, b"").expect("the temp video can be written");
    current.keep(shell, video).expect("nothing else is open");
    (current, folder)
}

const SAVE_FIRST: &str = "Save this recording before closing?";
const EXPORT_FIRST: &str = "Export this recording before closing?";

#[test]
fn keep_should_show_the_preview_and_refuse_a_second_recording() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("keep", &shell);
    assert_eq!(*shell.switches.borrow(), [(Window::Bar, Window::Preview)]);
    let name = current.shown().expect("it's kept").1.name;
    assert_eq!(
        folder.file_name().and_then(|name| name.to_str()),
        Some(&*name)
    );
    let second = current.keep(&shell, folder.join("other.mov"));
    assert!(second.is_err());
    assert_eq!(current.shown().expect("still kept").1.name, name);
    assert_eq!(shell.switches.borrow().len(), 1);
}

#[test]
fn closing_unsaved_should_ask_and_cancel_should_keep_it() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("cancel", &shell);
    current.close(&shell).expect("canceling is fine");
    assert_eq!(*shell.asked.borrow(), [SAVE_FIRST]);
    assert_eq!(shell.last_switch(), (Window::Bar, Window::Preview));
    assert!(folder.exists());
    assert!(current.shown().is_some());
}

#[test]
fn closing_unsaved_with_discard_should_bring_the_bar_back_and_delete() {
    let shell = FakeShell::answering(Choice::Second);
    let (current, folder) = keeping_one("delete", &shell);
    current.close(&shell).expect("closes");
    assert_eq!(*shell.asked.borrow(), [SAVE_FIRST]);
    assert_eq!(shell.last_switch(), (Window::Preview, Window::Bar));
    assert!(!folder.exists());
    assert!(current.shown().is_none());
}

#[test]
fn closing_saved_should_skip_the_alert_and_still_delete_the_recording() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("saved", &shell);
    let saved_to = folder.with_file_name("saved.mp4");
    std::fs::write(&saved_to, b"").expect("the temp export can be written");
    lock(&current.kept).as_mut().expect("kept").saved_to = Some(saved_to.clone());
    current.close(&shell).expect("closes");
    assert!(shell.asked.borrow().is_empty());
    assert!(!folder.exists());
    assert!(saved_to.exists());
}

#[test]
fn closing_the_editor_unexported_should_ask_and_hand_export_and_close_to_the_page() {
    let shell = FakeShell::answering(Choice::First);
    let (current, folder) = keeping_one("editor", &shell);
    current.edit(&shell).expect("edits");
    assert_eq!(shell.last_switch(), (Window::Preview, Window::Editor));
    current.close(&shell).expect("asks");
    assert_eq!(*shell.asked.borrow(), [EXPORT_FIRST]);
    assert_eq!(*shell.exports.borrow(), 1);
    assert_eq!(shell.last_switch(), (Window::Preview, Window::Editor));
    assert!(folder.exists());
    assert!(current.shown().is_some());
}

#[test]
fn closing_the_editor_with_discard_should_delete_the_recording_and_its_edits() {
    let shell = FakeShell::answering(Choice::Second);
    let (current, folder) = keeping_one("editor-discard", &shell);
    current.edit(&shell).expect("edits");
    current.save_project("{}").expect("the folder is writable");
    current.close(&shell).expect("closes");
    assert_eq!(shell.last_switch(), (Window::Editor, Window::Bar));
    assert!(!folder.exists());
    assert!(current.shown().is_none());
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

#[test]
fn a_project_should_save_next_to_the_video_and_load_back() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("project", &shell);
    assert_eq!(
        current.load_project().expect("a missing file is fine"),
        None
    );
    current
        .save_project(r#"{"version":1}"#)
        .expect("the folder is writable");
    assert!(folder.join(PROJECT_FILE).exists());
    assert_eq!(
        current
            .load_project()
            .expect("the file reads back")
            .as_deref(),
        Some(r#"{"version":1}"#)
    );
}

#[test]
fn a_background_picture_should_be_copied_beside_the_project_under_a_new_name() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("background", &shell);
    let picture = folder.with_file_name("Beach.JPG");
    std::fs::write(&picture, b"picture").expect("the temp picture can be written");
    let first = current
        .add_background(&picture)
        .expect("a JPEG is a picture");
    let second = current
        .add_background(&picture)
        .expect("again, beside the first");
    assert_eq!((&*first, &*second), ("background.jpg", "background 2.jpg"));
    assert_eq!(
        std::fs::read(folder.join(&first)).ok().as_deref(),
        Some(&b"picture"[..])
    );
    let text = folder.with_file_name("notes.txt");
    assert!(current.add_background(&text).is_err());
}

fn left_behind(current: &CurrentRecording, name: &str, video: &[u8]) -> PathBuf {
    let folder = current.named_folder(name);
    std::fs::create_dir_all(&folder).expect("the temp folder can be made");
    std::fs::write(folder.join("recording.mov"), video).expect("the temp video can be written");
    folder
}

fn nothing_open(test: &str) -> CurrentRecording {
    let root = std::env::temp_dir().join(format!("opentape-test-{test}"));
    let _ = std::fs::remove_dir_all(&root);
    CurrentRecording::new(Folders {
        storage: root.join("recordings"),
        downloads: root.join("Downloads"),
        copies: root.join("copies"),
    })
}

#[test]
fn recover_should_keep_the_newest_left_behind_recording_quietly_until_restored() {
    let shell = FakeShell::answering(Choice::Cancel);
    let current = nothing_open("recover");
    let older = left_behind(&current, "2026-10-24 09.00.00", b"video");
    let newest = left_behind(&current, "2026-10-25 09.00.00", b"video");
    let dev = left_behind(&current, "OpenTape test clip", b"video");
    for camera in ["camera.mov", "a-camera.mov", "z-camera.mov"] {
        std::fs::write(newest.join(camera), b"face").expect("the temp camera can be written");
    }
    current.recover(&shell).expect("the folder reads");
    assert!(shell.switches.borrow().is_empty());
    assert!(current.shown().is_none());
    assert!(current.can_restore());
    current.restore(&shell).expect("the leftover restores");
    assert_eq!(*shell.switches.borrow(), [(Window::Bar, Window::Preview)]);
    assert!(!current.can_restore());
    let shown = current.shown().expect("restored").1;
    assert_eq!(shown.name, "2026-10-25 09.00.00");
    assert!(shown.video_path.ends_with("recording.mov"));
    assert!(!older.exists());
    assert!(newest.exists());
    assert!(dev.exists());
}

#[test]
fn a_new_recording_should_replace_the_left_behind_one() {
    let shell = FakeShell::answering(Choice::Cancel);
    let current = nothing_open("replace-leftover");
    let leftover = left_behind(&current, "2026-10-24 09.00.00", b"video");
    current.recover(&shell).expect("the folder reads");
    let fresh = left_behind(&current, "2026-10-25 09.00.00", b"video");
    current
        .keep(&shell, fresh.join("recording.mov"))
        .expect("nothing is open");
    assert!(!leftover.exists());
    assert!(fresh.exists());
    assert!(!current.can_restore());
}

#[test]
fn recover_should_quietly_drop_an_empty_recording_and_do_nothing_when_none_is_left() {
    let shell = FakeShell::answering(Choice::Cancel);
    let current = nothing_open("recover-empty");
    current.recover(&shell).expect("a missing folder is fine");
    let empty = left_behind(&current, "2026-10-25 09.00.00", b"");
    current.recover(&shell).expect("the folder reads");
    assert!(!empty.exists());
    assert!(shell.switches.borrow().is_empty());
    assert!(current.shown().is_none());
}

#[test]
fn exports_should_go_to_the_chosen_folder_or_downloads() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, _) = keeping_one("save-folder", &shell);
    assert_eq!(current.output_folder(), current.folders.downloads);
    current.set_save_folder(Some(PathBuf::from("/tmp/exports")));
    assert_eq!(current.output_folder(), PathBuf::from("/tmp/exports"));
}

#[test]
fn the_cursor_log_should_come_with_its_meta_or_not_at_all() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("cursor-log", &shell);
    assert!(current.cursor_log().expect("it reads").is_none());
    std::fs::write(folder.join("meta.json"), "{}").expect("the meta can be written");
    assert!(current.cursor_log().expect("it reads").is_none());
    std::fs::write(folder.join("events.jsonl"), "{}\n").expect("the log can be written");
    let log = current
        .cursor_log()
        .expect("it reads")
        .expect("both are there");
    assert_eq!(log.meta, "{}");
}
