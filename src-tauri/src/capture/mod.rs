mod cursor_log;
mod plan;
mod timeline;
mod writer;

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use cidre::{arc, av, dispatch, ns, sc};

pub(crate) use plan::{
    CaptureSize, NORMAL_WINDOW_LAYER, Target, display_of, display_scale, shareable_content,
};

use self::cursor_log::CursorLogger;
use self::plan::{CapturePlan, plan_capture};
use self::timeline::{Timeline, host_time_now};
use self::writer::{OnStop, Recorder, StopWatcher, create_recorder, finish_writing};
use crate::util::{lock, wait};

const CAPTURE_LIMIT: Duration = Duration::from_secs(10);
const VIDEO_FILE: &str = "recording.mov";
pub(crate) const EVENTS_FILE: &str = "events.jsonl";
pub(crate) const META_FILE: &str = "meta.json";

#[derive(Debug, Clone, Default)]
pub(crate) struct Audio {
    pub microphone_id: Option<String>,
    pub system_audio: bool,
}

impl Audio {
    fn with_allowed_microphone(self) -> Self {
        if self.microphone_id.is_none() {
            return self;
        }
        let sound = av::MediaType::audio();
        let is_allowed = match av::CaptureDevice::authorization_status_for_media_type(sound) {
            Ok(av::AuthorizationStatus::Authorized) => true,
            Ok(av::AuthorizationStatus::NotDetermined) => matches!(
                wait(
                    "asking for the microphone",
                    Duration::from_secs(60),
                    av::CaptureDevice::request_access_for_media_type(sound)
                ),
                Ok(Ok(true))
            ),
            _ => false,
        };
        if is_allowed {
            return self;
        }
        log::warn!("microphone access is off, so this recording has no microphone");
        Self {
            microphone_id: None,
            ..self
        }
    }
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
}

impl RunningRecording {
    pub(crate) fn target(&self) -> &Target {
        &self.target
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
    audio: Audio,
    folder: PathBuf,
    on_stop: impl Fn(String) + Send + 'static,
) -> Result<RunningRecording> {
    let (started_tx, started_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (finished_tx, finished_rx) = mpsc::channel();
    let timeline = Arc::new(Mutex::new(Timeline::new(host_time_now())));
    thread::spawn({
        let (target, folder, timeline) = (target.clone(), folder.clone(), Arc::clone(&timeline));
        move || {
            let on_stop = Box::new(on_stop);
            let audio = audio.with_allowed_microphone();
            let capture = ActiveCapture::start(&target, &audio, &folder, timeline, on_stop);
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
    let _ = stop_rx.recv();
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
}

impl ActiveCapture {
    fn start(
        target: &Target,
        audio: &Audio,
        folder: &Path,
        timeline: Arc<Mutex<Timeline>>,
        on_stop: OnStop,
    ) -> Result<Self> {
        std::fs::create_dir_all(folder)
            .with_context(|| format!("could not create {}", folder.display()))?;
        let mut plan = plan_capture(target)?;
        plan.config.set_captures_audio(audio.system_audio);
        plan.config.set_excludes_current_process_audio(true);
        if let Some(microphone_id) = &audio.microphone_id {
            plan.config.set_capture_mic(true);
            plan.config
                .set_mic_capture_device_id(Some(&ns::String::with_str(microphone_id)));
        }
        let recorder = create_recorder(
            &folder.join(VIDEO_FILE),
            plan.size,
            audio,
            Arc::clone(&timeline),
        )?;
        let stop_watcher = StopWatcher::with(on_stop);
        let stream = sc::Stream::with_delegate(&plan.filter, &plan.config, stop_watcher.as_ref());
        let queue = dispatch::Queue::serial_with_ar_pool();
        stream
            .add_stream_output(recorder.as_ref(), sc::OutputType::Screen, Some(&queue))
            .map_err(|err| anyhow!("could not add stream output: {err:?}"))?;
        if audio.system_audio {
            stream
                .add_stream_output(recorder.as_ref(), sc::OutputType::Audio, Some(&queue))
                .map_err(|err| anyhow!("could not add system audio output: {err:?}"))?;
        }
        if audio.microphone_id.is_some() {
            stream
                .add_stream_output(recorder.as_ref(), sc::OutputType::Mic, Some(&queue))
                .map_err(|err| anyhow!("could not add microphone output: {err:?}"))?;
        }
        let cursor = CursorLogger::start(&folder.join(EVENTS_FILE))?;
        wait("starting the capture", CAPTURE_LIMIT, stream.start())?
            .map_err(|err| anyhow!("could not start capture: {err:?}"))?;
        *lock(&timeline) = Timeline::new(host_time_now());
        Ok(Self {
            stream,
            _stop_watcher: stop_watcher,
            queue,
            recorder,
            cursor,
            timeline,
            plan,
            folder: folder.to_path_buf(),
        })
    }

    fn finish(mut self) -> Result<SavedRecording> {
        let video_end = lock(&self.timeline).video_end(host_time_now());
        let stopped = wait("stopping the capture", CAPTURE_LIMIT, self.stream.stop());
        if let Err(err) = stopped.and_then(|it| it.map_err(|err| anyhow!("{err:?}"))) {
            log::warn!("could not stop the capture, keeping what it recorded: {err:#}");
        }
        self.queue.sync(|| {});
        let cursor = self.cursor.stop();
        let first_frame_time = finish_writing(&mut self.recorder, video_end)?;
        cursor?;
        let rect = self.plan.screen_rect;
        let pauses = serde_json::to_string(lock(&self.timeline).pauses())
            .unwrap_or_else(|_| "[]".to_string());
        let meta = format!(
            r#"{{
  "video_width": {},
  "video_height": {},
  "screen_rect": {{ "x": {:.1}, "y": {:.1}, "width": {:.1}, "height": {:.1} }},
  "first_frame_time": {first_frame_time:.6},
  "pauses": {pauses},
  "clock": "host time in seconds, same as the t values in events.jsonl; pauses are cut from the video"
}}
"#,
            self.plan.size.width,
            self.plan.size.height,
            rect.origin.x,
            rect.origin.y,
            rect.size.width,
            rect.size.height
        );
        std::fs::write(self.folder.join(META_FILE), meta).context("could not write meta.json")?;
        Ok(SavedRecording {
            video_path: self.folder.join(VIDEO_FILE).display().to_string(),
        })
    }
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
        }
    }
}
