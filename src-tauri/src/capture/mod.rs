//! Screen capture: record a display, a window or an area to a crash-safe `.mov` with
//! the cursor hidden, plus a cursor and click log.
//!
//! Apple's capture objects can't move between threads, so each recording runs on its
//! own thread. [`start`] hands back a [`RunningRecording`] that talks to that thread
//! through channels, and [`RunningRecording::stop`] finishes the file.

mod content;
mod cursor_log;
mod meta;
mod plan;
mod recorder;
mod timeline;
mod writer;

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard,
        mpsc::{self, Receiver, Sender},
    },
    thread,
};

use anyhow::{Context, Result, anyhow, bail};
use cidre::{arc, dispatch, sc};
use serde::Serialize;
use ts_rs::TS;

pub(crate) use content::{display_of, display_scale, shareable_content};
pub(crate) use plan::{CaptureSize, Target};

use crate::util::lock;
use cursor_log::{CursorLogger, host_time_now};
use meta::meta_json;
use plan::{CapturePlan, plan_capture};
use recorder::{Recorder, RecorderState};
use timeline::Timeline;
use writer::{create_writer, finish_writing};

/// A finished recording.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub(crate) struct SavedRecording {
    pub video_path: String,
}

/// A recording in progress. Dropping it without calling [`RunningRecording::stop`]
/// still stops and finishes the file, because the capture thread sees the channel close.
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

    /// Frames captured while paused are left out of the file.
    pub(crate) fn pause(&self) {
        self.timeline().pause(host_time_now());
    }

    pub(crate) fn resume(&self) {
        self.timeline().resume(host_time_now());
    }

    /// Seconds recorded so far, not counting pauses.
    pub(crate) fn elapsed(&self) -> f64 {
        self.timeline().elapsed(host_time_now())
    }

    pub(crate) fn stop(self) -> Result<SavedRecording> {
        // Fails only if the capture thread already ended, and then its result is waiting below.
        let _ = self.stop_tx.send(());
        self.finished_rx
            .recv()
            .context("the capture thread ended without finishing the file")?
    }

    /// Stops and deletes everything recorded, to start over.
    pub(crate) fn discard(self) -> Result<()> {
        let folder = self.folder.clone();
        self.stop()?;
        std::fs::remove_dir_all(&folder)
            .with_context(|| format!("could not delete {}", folder.display()))
    }

    fn timeline(&self) -> MutexGuard<'_, Timeline> {
        lock(&self.timeline)
    }
}

#[cfg(test)]
impl RunningRecording {
    /// A recording with no capture behind it, for testing what holds one. Stopping it hands
    /// back `video_path`.
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

/// Starts recording `target` into `folder` on a new thread, and returns once capture is running.
pub(crate) fn start(target: Target, folder: PathBuf) -> Result<RunningRecording> {
    let (started_tx, started_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (finished_tx, finished_rx) = mpsc::channel();
    let timeline = Arc::new(Mutex::new(Timeline::new(host_time_now())));
    thread::spawn({
        let (target, folder, timeline) = (target.clone(), folder.clone(), Arc::clone(&timeline));
        move || {
            let saved = record_until_stopped(&target, &folder, timeline, &started_tx, &stop_rx);
            // Fails only if the recording was dropped without `stop`, so no one wants the result.
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

/// Runs on the capture thread: starts, reports that it started, waits for stop, finishes.
fn record_until_stopped(
    target: &Target,
    folder: &Path,
    timeline: Arc<Mutex<Timeline>>,
    started_tx: &Sender<Result<()>>,
    stop_rx: &Receiver<()>,
) -> Result<SavedRecording> {
    // `start` waits for this answer, so each send below always has someone to receive it.
    let mut capture = match ActiveCapture::start(target, folder, timeline) {
        Ok(capture) => capture,
        Err(err) => {
            let _ = started_tx.send(Err(err));
            // `start` returns the error above, so no one reads this one.
            bail!("capture never started");
        }
    };
    let _ = started_tx.send(Ok(()));
    // Waits for a stop message, or for the sender to be dropped; either way, finish.
    let _ = stop_rx.recv();
    capture.finish()
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
        *lock(&timeline) = Timeline::new(host_time_now());
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

    /// Finishes the file. A stream that already stopped on its own, because its display was
    /// unplugged or Screen Recording was turned off, still leaves the frames it got.
    fn finish(&mut self) -> Result<SavedRecording> {
        if let Err(err) = pollster::block_on(self.stream.stop()) {
            eprintln!("capture had already stopped, keeping what it recorded: {err:?}");
        }
        // Frames are appended on `queue`; wait for any still in flight before finishing the file.
        self.queue.sync(|| {});
        // The video is finished before a cursor log error is reported, so it's never left open.
        let cursor = self.cursor.take().map_or(Ok(()), CursorLogger::stop);
        let first_frame_time = finish_writing(&mut self.recorder)?;
        cursor?;
        let pauses = lock(&self.timeline).pauses().to_vec();
        std::fs::write(
            self.folder.join("meta.json"),
            meta_json(&self.plan, first_frame_time, &pauses),
        )
        .context("could not write meta.json")?;
        Ok(SavedRecording {
            video_path: self.folder.join("recording.mov").display().to_string(),
        })
    }
}
