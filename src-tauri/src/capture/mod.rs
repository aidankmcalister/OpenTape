//! Each recording runs on its own thread: Apple's capture objects can't move between threads.

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
};

use anyhow::{Context, Result, anyhow, bail};
use cidre::{arc, dispatch, sc};

pub(crate) use plan::{
    CaptureSize, NORMAL_WINDOW_LAYER, Target, display_of, display_scale, shareable_content,
};

use self::cursor_log::CursorLogger;
use self::plan::{CapturePlan, plan_capture};
use self::timeline::{Timeline, host_time_now};
use self::writer::{Recorder, create_recorder, finish_writing};
use crate::util::lock;

const VIDEO_FILE: &str = "recording.mov";

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

pub(crate) fn start(target: Target, folder: PathBuf) -> Result<RunningRecording> {
    let (started_tx, started_rx) = mpsc::channel();
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
    target: &Target,
    folder: &Path,
    timeline: Arc<Mutex<Timeline>>,
    started_tx: &Sender<Result<()>>,
    stop_rx: &Receiver<()>,
) -> Result<SavedRecording> {
    let capture = match ActiveCapture::start(target, folder, timeline) {
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
    queue: arc::R<dispatch::Queue>,
    recorder: arc::R<Recorder>,
    cursor: CursorLogger,
    timeline: Arc<Mutex<Timeline>>,
    plan: CapturePlan,
    folder: PathBuf,
}

impl ActiveCapture {
    fn start(target: &Target, folder: &Path, timeline: Arc<Mutex<Timeline>>) -> Result<Self> {
        std::fs::create_dir_all(folder)
            .with_context(|| format!("could not create {}", folder.display()))?;
        let plan = plan_capture(target)?;
        let recorder = create_recorder(&folder.join(VIDEO_FILE), plan.size, Arc::clone(&timeline))?;
        let stream = sc::Stream::new(&plan.filter, &plan.config);
        let queue = dispatch::Queue::serial_with_ar_pool();
        stream
            .add_stream_output(recorder.as_ref(), sc::OutputType::Screen, Some(&queue))
            .map_err(|err| anyhow!("could not add stream output: {err:?}"))?;
        let cursor = CursorLogger::start(&folder.join("events.jsonl"))?;
        pollster::block_on(stream.start())
            .map_err(|err| anyhow!("could not start capture: {err:?}"))?;
        // Restarts the clock now that capture runs, so the timer matches the file.
        *lock(&timeline) = Timeline::new(host_time_now());
        Ok(Self {
            stream,
            queue,
            recorder,
            cursor,
            timeline,
            plan,
            folder: folder.to_path_buf(),
        })
    }

    fn finish(mut self) -> Result<SavedRecording> {
        if let Err(err) = pollster::block_on(self.stream.stop()) {
            eprintln!("capture had already stopped, keeping what it recorded: {err:?}");
        }
        // Waits for frames still being appended on `queue`.
        self.queue.sync(|| {});
        // The video is finished before a cursor log error is reported, so it's never left open.
        let cursor = self.cursor.stop();
        let first_frame_time = finish_writing(&mut self.recorder)?;
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
        std::fs::write(self.folder.join("meta.json"), meta).context("could not write meta.json")?;
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
