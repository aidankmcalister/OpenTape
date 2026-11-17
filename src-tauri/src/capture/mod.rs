mod cursor_log;
mod key_log;
mod plan;
mod timeline;
mod writer;

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    thread,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use cidre::{arc, av, cg, dispatch, ns, sc};

pub(crate) use plan::{
    CaptureSize, NORMAL_WINDOW_LAYER, Target, display_of, display_scale, shareable_content,
};

use self::cursor_log::CursorLogger;
use self::plan::{CapturePlan, kept_inside, plan_capture, window_frame};
use self::timeline::{Timeline, host_time_now};
use self::writer::{OnStop, Recorder, StopWatcher, create_recorder, finish_writing};
use crate::geometry::to_display_relative;
use crate::util::{lock, wait};

const CAPTURE_LIMIT: Duration = Duration::from_secs(10);
/// How often a recorded window's position is checked, so the crop follows it when it moves.
const FOLLOW_EVERY: Duration = Duration::from_millis(33);
pub(crate) const VIDEO_FILE: &str = "recording.mov";
pub(crate) const EVENTS_FILE: &str = "events.jsonl";
pub(crate) const META_FILE: &str = "meta.json";

#[derive(Debug, Clone, Default)]
pub(crate) struct Inputs {
    pub microphone_id: Option<String>,
    pub system_audio: bool,
    /// Record which keys were pressed, not only when (Record keystrokes).
    pub records_keys: bool,
}

impl Inputs {
    fn with_allowed_devices(self) -> Self {
        Self {
            microphone_id: (self.microphone_id)
                .filter(|_| is_allowed(av::MediaType::audio(), "microphone")),
            ..self
        }
    }
}

fn is_allowed(media: &av::MediaType, device: &str) -> bool {
    let is_allowed = match av::CaptureDevice::authorization_status_for_media_type(media) {
        Ok(av::AuthorizationStatus::Authorized) => true,
        Ok(av::AuthorizationStatus::NotDetermined) => matches!(
            wait(
                &format!("asking for the {device}"),
                Duration::from_secs(60),
                av::CaptureDevice::request_access_for_media_type(media)
            ),
            Ok(Ok(true))
        ),
        _ => false,
    };
    if !is_allowed {
        log::warn!("{device} access is off, so this recording has no {device}");
    }
    is_allowed
}

#[derive(Debug)]
pub(crate) struct SavedRecording {
    pub video_path: String,
}

pub(crate) struct RunningRecording {
    target: Target,
    folder: PathBuf,
    timeline: Arc<Mutex<Timeline>>,
    stop_tx: Sender<()>,
    finished_rx: Receiver<Result<SavedRecording>>,
    microphone_refused: bool,
}

impl RunningRecording {
    pub(crate) fn target(&self) -> &Target {
        &self.target
    }

    pub(crate) fn microphone_refused(&self) -> bool {
        self.microphone_refused
    }

    pub(crate) fn pause(&self) {
        lock(&self.timeline).pause(host_time_now());
    }

    pub(crate) fn resume(&self) {
        lock(&self.timeline).resume(host_time_now());
    }

    pub(crate) fn elapsed(&self) -> f64 {
        lock(&self.timeline).elapsed(host_time_now())
    }

    pub(crate) fn stop(self) -> Result<SavedRecording> {
        let _ = self.stop_tx.send(());
        self.finished_rx
            .recv()
            .context("the capture thread ended without finishing the file")?
    }

    pub(crate) fn discard(self) -> Result<()> {
        let folder = self.folder.clone();
        self.stop()?;
        std::fs::remove_dir_all(&folder)
            .with_context(|| format!("could not delete {}", folder.display()))
    }
}

pub(crate) fn start(
    target: Target,
    inputs: Inputs,
    folder: PathBuf,
    on_stop: impl Fn(String) + Send + 'static,
) -> Result<RunningRecording> {
    let (started_tx, started_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (finished_tx, finished_rx) = mpsc::channel();
    let timeline = Arc::new(Mutex::new(Timeline::new(host_time_now())));
    let wants_microphone = inputs.microphone_id.is_some();
    let inputs = inputs.with_allowed_devices();
    let microphone_refused = wants_microphone && inputs.microphone_id.is_none();
    thread::spawn({
        let (target, folder, timeline) = (target.clone(), folder.clone(), Arc::clone(&timeline));
        move || {
            let on_stop = Box::new(on_stop);
            let capture = ActiveCapture::start(&target, &inputs, &folder, timeline, on_stop);
            let saved = record_until_stopped(capture, &started_tx, &stop_rx);
            let _ = finished_tx.send(saved);
        }
    });
    started_rx
        .recv()
        .context("the capture thread ended before starting")??;
    Ok(RunningRecording {
        target,
        folder,
        timeline,
        stop_tx,
        finished_rx,
        microphone_refused,
    })
}

fn record_until_stopped(
    capture: Result<ActiveCapture>,
    started_tx: &Sender<Result<()>>,
    stop_rx: &Receiver<()>,
) -> Result<SavedRecording> {
    let capture = match capture {
        Ok(capture) => capture,
        Err(err) => {
            let _ = started_tx.send(Err(err));
            bail!("capture never started");
        }
    };
    let _ = started_tx.send(Ok(()));
    let mut capture = capture;
    while let Err(RecvTimeoutError::Timeout) = stop_rx.recv_timeout(FOLLOW_EVERY) {
        capture.follow_window();
    }
    capture.finish()
}

struct ActiveCapture {
    stream: arc::R<sc::Stream>,
    _stop_watcher: arc::R<StopWatcher>,
    queue: arc::R<dispatch::Queue>,
    recorder: arc::R<Recorder>,
    cursor: CursorLogger,
    timeline: Arc<Mutex<Timeline>>,
    plan: CapturePlan,
    folder: PathBuf,
    /// Where the crop is now, and each time it moved: `[host time, x, y]` in screen points.
    origin: cg::Point,
    window_moves: Vec<[f64; 3]>,
}

impl ActiveCapture {
    fn start(
        target: &Target,
        inputs: &Inputs,
        folder: &Path,
        timeline: Arc<Mutex<Timeline>>,
        on_stop: OnStop,
    ) -> Result<Self> {
        std::fs::create_dir_all(folder)
            .with_context(|| format!("could not create {}", folder.display()))?;
        let mut plan = plan_capture(target)?;
        plan.config.set_captures_audio(inputs.system_audio);
        plan.config.set_excludes_current_process_audio(true);
        if let Some(microphone_id) = &inputs.microphone_id {
            plan.config.set_capture_mic(true);
            plan.config
                .set_mic_capture_device_id(Some(&ns::String::with_str(microphone_id)));
        }
        let recorder = create_recorder(
            &folder.join(VIDEO_FILE),
            plan.size,
            inputs,
            Arc::clone(&timeline),
        )?;
        let stop_watcher = StopWatcher::with(on_stop);
        let stream = sc::Stream::with_delegate(&plan.filter, &plan.config, stop_watcher.as_ref());
        let queue = dispatch::Queue::serial_with_ar_pool();
        stream
            .add_stream_output(recorder.as_ref(), sc::OutputType::Screen, Some(&queue))
            .map_err(|err| anyhow!("could not add stream output: {err:?}"))?;
        if inputs.system_audio {
            stream
                .add_stream_output(recorder.as_ref(), sc::OutputType::Audio, Some(&queue))
                .map_err(|err| anyhow!("could not add system audio output: {err:?}"))?;
        }
        if inputs.microphone_id.is_some() {
            stream
                .add_stream_output(recorder.as_ref(), sc::OutputType::Mic, Some(&queue))
                .map_err(|err| anyhow!("could not add microphone output: {err:?}"))?;
        }
        let cursor = CursorLogger::start(&folder.join(EVENTS_FILE), inputs.records_keys)?;
        wait("starting the capture", CAPTURE_LIMIT, stream.start())?
            .map_err(|err| anyhow!("could not start capture: {err:?}"))?;
        lock(&timeline).started = host_time_now();
        Ok(Self {
            stream,
            _stop_watcher: stop_watcher,
            queue,
            recorder,
            cursor,
            timeline,
            origin: plan.screen_rect.origin,
            plan,
            folder: folder.to_path_buf(),
            window_moves: Vec::new(),
        })
    }

    /// Moves the crop to where the recorded window is now, if it moved, and notes when.
    fn follow_window(&mut self) {
        let Some(follow) = &self.plan.follows else {
            return;
        };
        let Some(frame) = window_frame(follow.window_id) else {
            return;
        };
        let size = self.plan.screen_rect.size;
        let origin = kept_inside(frame.origin, size, follow.display);
        if origin == self.origin {
            return;
        }
        self.origin = origin;
        let rect = cg::Rect { origin, size };
        self.plan
            .config
            .set_src_rect(to_display_relative(rect, follow.display));
        self.stream.update_cfg_ch(&self.plan.config, |err| {
            if let Some(err) = err {
                log::warn!("could not move the window crop: {err:?}");
            }
        });
        self.window_moves
            .push([host_time_now(), origin.x, origin.y]);
    }

    fn finish(mut self) -> Result<SavedRecording> {
        let video_end = lock(&self.timeline).video_end(host_time_now());
        match wait("stopping the capture", CAPTURE_LIMIT, self.stream.stop()) {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                log::warn!("could not stop the capture, keeping what it recorded: {err:?}")
            }
            Err(err) => log::warn!("could not stop the capture, keeping what it recorded: {err:#}"),
        }
        self.queue.sync(|| {});
        let records_keys = self.cursor.records_keys;
        let cursor = self.cursor.stop();
        let first_frame_time = finish_writing(&mut self.recorder, video_end)?;
        cursor?;
        let pauses = lock(&self.timeline).pauses().to_vec();
        let meta = meta_json(
            self.plan.size,
            self.plan.screen_rect,
            first_frame_time,
            &pauses,
            &self.window_moves,
            records_keys,
        );
        std::fs::write(self.folder.join(META_FILE), meta).context("could not write meta.json")?;
        Ok(SavedRecording {
            video_path: self.folder.join(VIDEO_FILE).display().to_string(),
        })
    }
}

fn meta_json(
    size: CaptureSize,
    rect: cg::Rect,
    first_frame_time: f64,
    pauses: &[[f64; 2]],
    window_moves: &[[f64; 3]],
    records_keys: bool,
) -> String {
    let meta = serde_json::json!({
        "video_width": size.width,
        "video_height": size.height,
        "screen_rect": { "x": rect.origin.x, "y": rect.origin.y, "width": rect.size.width, "height": rect.size.height },
        "first_frame_time": first_frame_time,
        "pauses": pauses,
        "window_moves": window_moves,
        "records_keys": records_keys,
        "clock": "host time in seconds, same as the t values in events.jsonl; pauses are cut from the video; window_moves are [t, x, y] where the recorded window's crop moved to",
    });
    serde_json::to_string_pretty(&meta).unwrap_or_default() + "\n"
}

#[cfg(test)]
impl RunningRecording {
    pub(crate) fn fake(video_path: &str) -> Self {
        let (stop_tx, _) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let saved = SavedRecording {
            video_path: video_path.to_string(),
        };
        finished_tx
            .send(Ok(saved))
            .expect("the receiver is right here");
        Self {
            target: Target::Display { display_id: 1 },
            folder: PathBuf::from(video_path),
            timeline: Arc::new(Mutex::new(Timeline::new(0.0))),
            stop_tx,
            finished_rx,
            microphone_refused: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    #[test]
    fn meta_should_hold_the_size_rect_first_frame_and_pauses() {
        let size = CaptureSize {
            width: 1920,
            height: 1080,
        };
        let rect = cg::Rect::new(0.0, 25.0, 960.0, 540.0);
        let moves = [[103.0, 40.0, 60.0]];
        let json = meta_json(size, rect, 100.5, &[[101.0, 102.0]], &moves, true);
        let meta = serde_json::from_str::<Value>(&json).expect("meta.json is JSON");
        assert_eq!(meta["video_width"], 1920);
        assert_eq!(meta["screen_rect"]["y"], 25.0);
        assert_eq!(meta["first_frame_time"], 100.5);
        assert_eq!(meta["pauses"], json!([[101.0, 102.0]]));
        assert_eq!(meta["records_keys"], true);
        assert_eq!(meta["window_moves"], json!([[103.0, 40.0, 60.0]]));
    }
}
