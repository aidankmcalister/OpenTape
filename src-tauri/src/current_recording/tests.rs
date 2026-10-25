use std::cell::RefCell;

use super::*;

struct FakeShell {
    answer: Choice,
    asked: RefCell<Vec<&'static str>>,
    switches: RefCell<Vec<(Window, Window)>>,
    trashed: RefCell<Vec<PathBuf>>,
}

impl FakeShell {
    fn answering(answer: Choice) -> Self {
        Self {
            answer,
            asked: RefCell::default(),
            switches: RefCell::default(),
            trashed: RefCell::default(),
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

    fn trash(&self, folder: &Path) -> Result<()> {
        self.trashed.borrow_mut().push(folder.to_path_buf());
        Ok(())
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
    let folder = current.new_folder().expect("the temp folder can be made");
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
fn closing_saved_should_skip_the_alert_and_keep_it() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, folder) = keeping_one("saved", &shell);
    let saved_to = folder.with_file_name("saved.mp4");
    std::fs::write(&saved_to, b"").expect("the temp export can be written");
    lock(&current.kept).as_mut().expect("kept").saved_to = Some(saved_to);
    current.close(&shell).expect("closes");
    assert!(shell.asked.borrow().is_empty());
    assert!(folder.exists());
}

#[test]
fn closing_from_the_editor_should_keep_it_without_asking_or_saving() {
    let shell = FakeShell::answering(Choice::Second);
    let (current, folder) = keeping_one("editor", &shell);
    current.edit(&shell).expect("edits");
    assert_eq!(shell.last_switch(), (Window::Preview, Window::Editor));
    current.close(&shell).expect("closes");
    assert!(shell.asked.borrow().is_empty());
    assert_eq!(shell.last_switch(), (Window::Editor, Window::Bar));
    assert!(folder.exists());
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

fn stored_recording(current: &CurrentRecording, name: &str, with_project: bool) -> PathBuf {
    let folder = current.named_folder(name);
    std::fs::create_dir_all(&folder).expect("the temp folder can be made");
    std::fs::write(folder.join("recording.mov"), b"video").expect("the temp video can be written");
    if with_project {
        std::fs::write(folder.join(PROJECT_FILE), b"{}").expect("the project can be written");
    }
    folder
}

#[test]
fn kept_recordings_should_list_folders_with_a_video_and_mark_edited_ones() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, open) = keeping_one("list", &shell);
    stored_recording(&current, "edited", true);
    std::fs::create_dir_all(current.named_folder("empty")).expect("the temp folder can be made");
    let recordings = current.kept_recordings().expect("the folder reads");
    let folders: Vec<_> = recordings.iter().map(|kept| kept.folder.as_str()).collect();
    assert_eq!(folders.len(), 2);
    assert!(folders.contains(&"edited"));
    assert!(folders.contains(&folder_name(&open).as_str()));
    let edited = recordings
        .iter()
        .find(|kept| kept.folder == "edited")
        .expect("listed");
    assert!(edited.is_edited);
    assert_eq!(edited.size_bytes, 7.0);
    assert!(
        recordings
            .windows(2)
            .all(|pair| pair[0].modified_ms >= pair[1].modified_ms)
    );
}

#[test]
fn kept_recordings_should_be_empty_before_anything_is_recorded() {
    let current = CurrentRecording::new(Folders {
        storage: std::env::temp_dir().join("screen-recorder-test-none/recordings"),
        downloads: PathBuf::new(),
        copies: PathBuf::new(),
    });
    assert!(
        current
            .kept_recordings()
            .expect("a missing folder is fine")
            .is_empty()
    );
}

#[test]
fn reopen_should_go_straight_to_the_editor_and_refuse_a_second_one() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, _) = keeping_one("reopen", &shell);
    stored_recording(&current, "older", true);
    let err = current.reopen(&shell, "older").expect_err("one is open");
    assert!(format!("{err:#}").contains("still open"));
    *lock(&current.kept) = None;
    current.reopen(&shell, "older").expect("nothing is open");
    assert_eq!(shell.last_switch(), (Window::Bar, Window::Editor));
    assert_eq!(current.shown().expect("it's open").name, "older");
}

#[test]
fn reopen_and_trash_should_only_take_folder_names_inside_recordings() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, _) = keeping_one("names", &shell);
    for name in ["", "..", "../recordings", "missing"] {
        assert!(current.reopen(&shell, name).is_err(), "{name:?}");
        assert!(current.trash(&shell, name).is_err(), "{name:?}");
    }
    assert!(shell.trashed.borrow().is_empty());
}

#[test]
fn trash_should_refuse_the_open_recording_and_move_others() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, open) = keeping_one("trash", &shell);
    let older = stored_recording(&current, "older", false);
    assert!(current.trash(&shell, &folder_name(&open)).is_err());
    current.trash(&shell, "older").expect("it's closed");
    assert_eq!(*shell.trashed.borrow(), [older]);
}

#[test]
fn a_recording_cut_off_before_it_was_kept_should_list_first_as_recovered() {
    let shell = FakeShell::answering(Choice::Cancel);
    let (current, kept) = keeping_one("recovered", &shell);
    assert!(!kept.join(RECORDING_MARKER).exists());
    let cut_off = current.named_folder("cut off");
    std::fs::create_dir_all(&cut_off).expect("the temp folder can be made");
    std::fs::write(cut_off.join(RECORDING_MARKER), b"").expect("the marker can be written");
    std::fs::write(cut_off.join("recording.mov"), b"").expect("the temp video can be written");
    let recordings = current.kept_recordings().expect("the folder reads");
    assert_eq!(recordings[0].folder, "cut off");
    assert!(recordings[0].is_recovered);
    assert!(recordings[1..].iter().all(|kept| !kept.is_recovered));
}
