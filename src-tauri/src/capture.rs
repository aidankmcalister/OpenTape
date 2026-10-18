//! Screen capture: record a display, a window or an area to a crash-safe `.mov` with
//! the cursor hidden, plus a cursor and click log.
//!
//! Apple's capture objects can't move between threads, so each recording runs on its
//! own thread. [`start`] hands back a [`RunningRecording`] that talks to that thread
//! through channels, and [`RunningRecording::stop`] finishes the file.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        mpsc::{self, Receiver, Sender},
    },
    thread,
};

use anyhow::{Context, Result, anyhow};
use cidre::{arc, av, cg, cm, dispatch, ns, sc, sys};
use serde::{Deserialize, Serialize};

use crate::cursor_log::{CursorLogger, host_time_now};
use crate::recorder::{Recorder, RecorderState};
use crate::timeline::Timeline;

const FRAMES_PER_SECOND: i32 = 60;
const FRAGMENT_SECONDS: i64 = 2;
const BITS_PER_PIXEL_PER_SECOND: usize = 8;

/// What to record. Sent from the frontend as `{ kind: "window", windowId: 398 }` and so on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Target {
    Display {
        display_id: u32,
    },
    Window {
        window_id: u32,
    },
    /// A rectangle in points, measured from the display's top-left corner.
    Area {
        display_id: u32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

/// A finished recording.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRecording {
    pub video_path: String,
}

/// A recording in progress. Dropping it without calling [`RunningRecording::stop`]
/// still stops and finishes the file, because the capture thread sees the channel close.
pub struct RunningRecording {
    target: Target,
    folder: PathBuf,
    timeline: Arc<Mutex<Timeline>>,
    stop_tx: Sender<()>,
    finished_rx: Receiver<Result<SavedRecording>>,
}

impl RunningRecording {
    pub fn target(&self) -> &Target {
        &self.target
    }

    /// Frames captured while paused are left out of the file.
    pub fn pause(&self) {
        self.timeline().pause(host_time_now());
    }

    pub fn resume(&self) {
        self.timeline().resume(host_time_now());
    }

    /// Seconds recorded so far, not counting pauses.
    pub fn elapsed(&self) -> f64 {
        self.timeline().elapsed(host_time_now())
    }

    pub fn stop(self) -> Result<SavedRecording> {
        let _ = self.stop_tx.send(());
        self.finished_rx
            .recv()
            .context("the capture thread ended without finishing the file")?
    }

    /// Stops and deletes everything recorded, to start over.
    pub fn discard(self) -> Result<()> {
        let folder = self.folder.clone();
        self.stop()?;
        std::fs::remove_dir_all(&folder)
            .with_context(|| format!("could not delete {}", folder.display()))
    }

    fn timeline(&self) -> MutexGuard<'_, Timeline> {
        self.timeline.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Starts recording `target` into `folder` on a new thread, and returns once capture is running.
pub fn start(target: Target, folder: PathBuf) -> Result<RunningRecording> {
    let (started_tx, started_rx) = mpsc::channel::<Result<(), String>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (finished_tx, finished_rx) = mpsc::channel();
    let timeline = Arc::new(Mutex::new(Timeline::new(host_time_now())));
    thread::spawn({
        let (target, folder, timeline) = (target.clone(), folder.clone(), Arc::clone(&timeline));
        move || {
            let saved = record_until_stopped(&target, &folder, timeline, &started_tx, &stop_rx);
            let _ = finished_tx.send(saved);
        }
    });
    started_rx
        .recv()
        .context("the capture thread ended before starting")?
        .map_err(|message| anyhow!(message))?;
    Ok(RunningRecording {
        target,
        folder,
        timeline,
        stop_tx,
        finished_rx,
    })
}

/// Runs on the capture thread: starts, reports that it started, waits for stop, finishes.
fn record_until_stopped(
    target: &Target,
    folder: &Path,
    timeline: Arc<Mutex<Timeline>>,
    started_tx: &Sender<Result<(), String>>,
    stop_rx: &Receiver<()>,
) -> Result<SavedRecording> {
    let mut capture = match ActiveCapture::start(target, folder, timeline) {
        Ok(capture) => capture,
        Err(err) => {
            let _ = started_tx.send(Err(format!("{err:#}")));
            return Err(err);
        }
    };
    let _ = started_tx.send(Ok(()));
    // Waits for a stop message, or for the sender to be dropped; either way, finish.
    let _ = stop_rx.recv();
    capture.finish()
}

/// Everything needed to start a capture, whatever the target.
struct CapturePlan {
    filter: arc::R<sc::ContentFilter>,
    cfg: arc::R<sc::StreamCfg>,
    size: CaptureSize,
    /// Where the captured content was on screen at the start, in global points.
    screen_rect: cg::Rect,
}

/// A running capture. Lives only on the capture thread.
struct ActiveCapture {
    stream: arc::R<sc::Stream>,
    queue: arc::R<dispatch::Queue>,
    recorder: arc::R<Recorder>,
    cursor: Option<CursorLogger>,
    timeline: Arc<Mutex<Timeline>>,
    plan: CapturePlan,
    folder: PathBuf,
}

impl ActiveCapture {
    fn start(target: &Target, folder: &Path, timeline: Arc<Mutex<Timeline>>) -> Result<Self> {
        std::fs::create_dir_all(folder)
            .with_context(|| format!("could not create {}", folder.display()))?;
        let plan = plan_capture(target)?;
        let (writer, input, adaptor) = create_writer(&folder.join("recording.mov"), plan.size)?;
        let recorder = Recorder::with(RecorderState::new(
            writer,
            input,
            adaptor,
            Arc::clone(&timeline),
        ));
        let stream = sc::Stream::new(&plan.filter, &plan.cfg);
        let queue = dispatch::Queue::serial_with_ar_pool();
        stream
            .add_stream_output(recorder.as_ref(), sc::OutputType::Screen, Some(&queue))
            .map_err(|err| anyhow!("could not add stream output: {err:?}"))?;
        let cursor = CursorLogger::start(&folder.join("events.jsonl"))?;
        pollster::block_on(stream.start())
            .map_err(|err| anyhow!("could not start capture: {err:?}"))?;
        // The clock starts once capture has, so the timer matches the file. Nothing can have
        // paused yet, because the caller only gets the recording after this returns.
        *timeline.lock().unwrap_or_else(PoisonError::into_inner) = Timeline::new(host_time_now());
        Ok(Self {
            stream,
            queue,
            recorder,
            cursor: Some(cursor),
            timeline,
            plan,
            folder: folder.to_path_buf(),
        })
    }

    fn finish(&mut self) -> Result<SavedRecording> {
        pollster::block_on(self.stream.stop())
            .map_err(|err| anyhow!("could not stop capture: {err:?}"))?;
        // Frames are appended on `queue`; wait for any still in flight before finishing the file.
        self.queue.sync(|| {});
        if let Some(cursor) = self.cursor.take() {
            cursor.stop()?;
        }
        let first_frame_time = finish_writing(&mut self.recorder)?;
        let timeline = self.timeline.lock().unwrap_or_else(PoisonError::into_inner);
        std::fs::write(
            self.folder.join("meta.json"),
            meta_json(&self.plan, first_frame_time, timeline.pauses()),
        )
        .context("could not write meta.json")?;
        Ok(SavedRecording {
            video_path: self.folder.join("recording.mov").display().to_string(),
        })
    }
}

/// Output video size in pixels, always even because H.264 needs even dimensions.
/// A recording's size in pixels: what the file will be, and what the picker shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CaptureSize {
    width: usize,
    height: usize,
}

impl CaptureSize {
    pub fn of(rect: cg::Rect, scale: f64) -> Self {
        Self {
            width: even_pixels(rect.size.width, scale),
            height: even_pixels(rect.size.height, scale),
        }
    }

    fn bitrate(self) -> i64 {
        (self.width * self.height * BITS_PER_PIXEL_PER_SECOND) as i64
    }
}

fn plan_capture(target: &Target) -> Result<CapturePlan> {
    let content = shareable_content()?;
    match *target {
        Target::Display { display_id } => {
            let display = find_display(&content, display_id)?;
            let screen_rect = display.frame();
            let size = CaptureSize::of(screen_rect, display_scale(&display));
            Ok(CapturePlan {
                filter: without_this_app(&content, &display),
                cfg: stream_config(size),
                size,
                screen_rect,
            })
        }
        Target::Window { window_id } => {
            let window = find_window(&content, window_id)?;
            let display = display_of(&content, &window)?;
            let app = window.owning_app().context("window has no app")?;
            let screen_rect = window.frame();
            let size = CaptureSize::of(screen_rect, display_scale(&display));
            let mut cfg = stream_config(size);
            cfg.set_src_rect(relative_to(screen_rect, display.frame()));
            Ok(CapturePlan {
                filter: sc::ContentFilter::with_display_excluding_windows(
                    &display,
                    &hidden_windows(&content, Hiding::of(Some(app.process_id()))),
                ),
                cfg,
                size,
                screen_rect,
            })
        }
        Target::Area {
            display_id,
            x,
            y,
            width,
            height,
        } => {
            let display = find_display(&content, display_id)?;
            let rect = cg::Rect::new(x, y, width, height);
            let size = CaptureSize::of(rect, display_scale(&display));
            let mut cfg = stream_config(size);
            cfg.set_src_rect(rect);
            Ok(CapturePlan {
                filter: without_this_app(&content, &display),
                cfg,
                size,
                screen_rect: on_screen(rect, display.frame()),
            })
        }
    }
}

pub fn shareable_content() -> Result<arc::R<sc::ShareableContent>> {
    pollster::block_on(sc::ShareableContent::current())
        .map_err(|err| anyhow!("could not read the screen (is Screen Recording allowed?): {err:?}"))
}

fn find_window(content: &sc::ShareableContent, window_id: u32) -> Result<arc::R<sc::Window>> {
    content
        .windows()
        .iter()
        .find(|window| window.id() == window_id)
        .map(|window| window.retained())
        .with_context(|| format!("window {window_id} is gone"))
}

fn find_display(content: &sc::ShareableContent, display_id: u32) -> Result<arc::R<sc::Display>> {
    content
        .displays()
        .iter()
        .find(|display| display.display_id().0 == display_id)
        .map(|display| display.retained())
        .with_context(|| format!("display {display_id} is gone"))
}

pub fn display_of(
    content: &sc::ShareableContent,
    window: &sc::Window,
) -> Result<arc::R<sc::Display>> {
    let origin = window.frame().origin;
    content
        .displays()
        .iter()
        .find(|display| display.frame().contains_point(&origin))
        .map(|display| display.retained())
        .context("the window is not on any display")
}

pub fn display_scale(display: &sc::Display) -> f64 {
    let filter = sc::ContentFilter::with_display_excluding_windows(display, &ns::Array::new());
    f64::from(sc::ShareableContent::info_for_filter(&filter).point_pixel_scale())
}

/// The whole display without this app, including windows it opens after capture starts, like
/// the frame and alerts. Falls back to leaving out this app's current windows.
fn without_this_app(
    content: &sc::ShareableContent,
    display: &sc::Display,
) -> arc::R<sc::ContentFilter> {
    let own_pid = Hiding::of(None).own_pid;
    let own_app: Vec<arc::R<sc::RunningApp>> = content
        .apps()
        .iter()
        .filter(|app| app.process_id() == own_pid)
        .map(|app| app.retained())
        .collect();
    if own_app.is_empty() {
        return sc::ContentFilter::with_display_excluding_windows(
            display,
            &hidden_windows(content, Hiding::of(None)),
        );
    }
    sc::ContentFilter::with_display_excluding_apps_excepting_windows(
        display,
        &ns::Array::from_slice_retained(&own_app),
        &ns::Array::new(),
    )
}

/// Every other app's normal windows (layer 0). Window recordings hide these, so windows
/// dragged over the recorded one don't show, while dragged items and menus still do.
fn hidden_windows(content: &sc::ShareableContent, hiding: Hiding) -> arc::R<ns::Array<sc::Window>> {
    let hidden: Vec<arc::R<sc::Window>> = content
        .windows()
        .iter()
        .filter(|window| {
            let owner = window.owning_app().map(|app| app.process_id());
            hiding.hides(window.window_layer(), owner)
        })
        .map(|window| window.retained())
        .collect();
    ns::Array::from_slice_retained(&hidden)
}

/// Which windows a capture leaves out.
#[derive(Debug, Clone, Copy)]
struct Hiding {
    own_pid: sys::Pid,
    /// Set when recording a window: the app that owns it.
    recorded_app: Option<sys::Pid>,
}

impl Hiding {
    fn of(recorded_app: Option<sys::Pid>) -> Self {
        Self {
            own_pid: sys::Pid::try_from(std::process::id()).unwrap_or(-1),
            recorded_app,
        }
    }

    /// This app's windows (the bar, the overlays) never show. When recording a window, other
    /// apps' normal windows (layer 0) hide too; higher layers (drags, menus, tooltips) stay.
    fn hides(self, layer: isize, owner: Option<sys::Pid>) -> bool {
        let Some(owner) = owner else {
            return false;
        };
        owner == self.own_pid
            || self
                .recorded_app
                .is_some_and(|app| layer == 0 && owner != app)
    }
}

fn stream_config(size: CaptureSize) -> arc::R<sc::StreamCfg> {
    let mut cfg = sc::StreamCfg::new();
    cfg.set_width(size.width);
    cfg.set_height(size.height);
    cfg.set_shows_cursor(false);
    cfg.set_minimum_frame_interval(cm::Time::new(1, FRAMES_PER_SECOND));
    cfg
}

/// Global screen rectangle to one relative to the display, which `src_rect` expects.
fn relative_to(rect: cg::Rect, display_frame: cg::Rect) -> cg::Rect {
    let mut relative = rect;
    relative.origin.x -= display_frame.origin.x;
    relative.origin.y -= display_frame.origin.y;
    relative
}

/// Display-relative rectangle back to global screen points.
fn on_screen(rect: cg::Rect, display_frame: cg::Rect) -> cg::Rect {
    let mut global = rect;
    global.origin.x += display_frame.origin.x;
    global.origin.y += display_frame.origin.y;
    global
}

/// Points times screen scale, rounded down to an even number of pixels.
fn even_pixels(points: f64, scale: f64) -> usize {
    (points * scale) as usize / 2 * 2
}

type Writer = (
    arc::R<av::AssetWriter>,
    arc::R<av::AssetWriterInput>,
    arc::R<av::asset::WriterInputPixelBufAdaptor>,
);

fn create_writer(path: &Path, size: CaptureSize) -> Result<Writer> {
    let _ = std::fs::remove_file(path);
    let url = ns::Url::with_fs_path_str(&path.display().to_string(), false);
    let mut writer = av::AssetWriter::with_url_and_file_type(&url, av::FileType::qt())
        .map_err(|err| anyhow!("could not create {}: {err:?}", path.display()))?;
    // CONTEXT: finishing the file in 2-second fragments means a crash only loses the last fragment.
    writer.set_movie_fragment_interval(cm::Time::new(FRAGMENT_SECONDS, 1));

    let mut input = av::AssetWriterInput::with_media_type_and_output_settings(
        av::MediaType::video(),
        Some(&video_settings(size)),
    )
    .map_err(|err| anyhow!("video settings were rejected: {err:?}"))?;
    input.set_expects_media_data_in_real_time(true);
    writer
        .add_input(&input)
        .map_err(|err| anyhow!("could not add video input: {err:?}"))?;
    let adaptor = av::asset::WriterInputPixelBufAdaptor::with_input_writer(&input, None)
        .map_err(|err| anyhow!("could not prepare the video input: {err:?}"))?;
    writer.start_writing();
    Ok((writer, input, adaptor))
}

fn video_settings(size: CaptureSize) -> arc::R<ns::Dictionary<ns::String, ns::Id>> {
    // CONTEXT: cidre has no named constant for AVVideoAverageBitRateKey; its value is "AverageBitRate".
    let compression = ns::Dictionary::with_keys_values(
        &[ns::str!(c"AverageBitRate")],
        &[ns::Number::with_i64(size.bitrate()).as_ref()],
    );
    ns::Dictionary::with_keys_values(
        &[
            av::video::settings_keys::codec(),
            av::video::settings_keys::width(),
            av::video::settings_keys::height(),
            av::video::settings_keys::compression_props(),
        ],
        &[
            av::VideoCodec::h264().as_ref(),
            ns::Number::with_i64(size.width as i64).as_ref(),
            ns::Number::with_i64(size.height as i64).as_ref(),
            compression.as_ref(),
        ],
    )
}

fn finish_writing(recorder: &mut Recorder) -> Result<Option<f64>> {
    let state = recorder.inner_mut();
    state.input.mark_as_finished();
    let (done_tx, done_rx) = mpsc::channel();
    state.writer.finish_writing_with_ch(move || {
        let _ = done_tx.send(());
    });
    done_rx.recv().context("the file writer never finished")?;
    Ok(state.first_frame_time)
}

fn meta_json(plan: &CapturePlan, first_frame_time: Option<f64>, pauses: &[[f64; 2]]) -> String {
    let rect = plan.screen_rect;
    let first_frame = first_frame_time.map_or_else(|| "null".to_string(), |t| format!("{t:.6}"));
    let pauses = serde_json::to_string(pauses).unwrap_or_else(|_| "[]".to_string());
    format!(
        r#"{{
  "video_width": {},
  "video_height": {},
  "screen_rect": {{ "x": {:.1}, "y": {:.1}, "width": {:.1}, "height": {:.1} }},
  "first_frame_time": {first_frame},
  "pauses": {pauses},
  "clock": "host time in seconds, same as the t values in events.jsonl; pauses are cut from the video"
}}
"#,
        plan.size.width,
        plan.size.height,
        rect.origin.x,
        rect.origin.y,
        rect.size.width,
        rect.size.height
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_should_read_a_window_from_the_frontend() {
        let target: Target = serde_json::from_str(r#"{"kind":"window","windowId":398}"#).unwrap();
        assert_eq!(target, Target::Window { window_id: 398 });
    }

    #[test]
    fn target_should_read_an_area_from_the_frontend() {
        let json = r#"{"kind":"area","displayId":1,"x":100,"y":50,"width":1280,"height":720}"#;
        let target: Target = serde_json::from_str(json).unwrap();
        assert_eq!(
            target,
            Target::Area {
                display_id: 1,
                x: 100.0,
                y: 50.0,
                width: 1280.0,
                height: 720.0
            }
        );
    }

    #[test]
    fn window_recording_should_hide_other_apps_normal_windows() {
        assert!(RECORDING_APP_100.hides(0, Some(200)));
    }

    #[test]
    fn window_recording_should_keep_the_target_apps_windows() {
        assert!(!RECORDING_APP_100.hides(0, Some(100)));
    }

    #[test]
    fn window_recording_should_keep_higher_layers_like_drags_and_menus() {
        assert!(!RECORDING_APP_100.hides(101, Some(200)));
    }

    #[test]
    fn every_recording_should_hide_this_apps_own_windows() {
        assert!(RECORDING_APP_100.hides(101, Some(1)));
        assert!(RECORDING_DISPLAY.hides(25, Some(1)));
        assert!(!RECORDING_DISPLAY.hides(0, Some(200)));
    }

    const RECORDING_APP_100: Hiding = Hiding {
        own_pid: 1,
        recorded_app: Some(100),
    };
    const RECORDING_DISPLAY: Hiding = Hiding {
        own_pid: 1,
        recorded_app: None,
    };

    #[test]
    fn relative_and_on_screen_should_undo_each_other() {
        let rect = cg::Rect::new(1700.0, 300.0, 920.0, 436.0);
        let display = cg::Rect::new(1512.0, -200.0, 1920.0, 1080.0);
        assert_eq!(on_screen(relative_to(rect, display), display), rect);
    }

    #[test]
    fn even_pixels_should_round_down_to_even() {
        assert_eq!(even_pixels(920.5, 2.0), 1840);
    }
}
