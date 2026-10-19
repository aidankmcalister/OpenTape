//! A recording's time, with its pauses cut out. All times are seconds on the host clock, the
//! clock ScreenCaptureKit stamps frames with, so frames and the record bar's timer agree.

use cidre::cm;

/// The host clock's time now, in seconds.
pub(super) fn host_time_now() -> f64 {
    cm::Clock::host_time_clock().time().as_secs()
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Timeline {
    started: f64,
    /// Finished pauses, as `[start, end]`, oldest first.
    pauses: Vec<[f64; 2]>,
    paused_at: Option<f64>,
}

impl Timeline {
    pub(super) fn new(started: f64) -> Self {
        Self {
            started,
            pauses: Vec::new(),
            paused_at: None,
        }
    }

    pub(super) fn pauses(&self) -> &[[f64; 2]] {
        &self.pauses
    }

    pub(super) fn pause(&mut self, now: f64) {
        self.paused_at.get_or_insert(now);
    }

    pub(super) fn resume(&mut self, now: f64) {
        if let Some(start) = self.paused_at.take() {
            self.pauses.push([start, now]);
        }
    }

    /// How long has been recorded by `now`, not counting pauses.
    pub(super) fn elapsed(&self, now: f64) -> f64 {
        let open_pause = self.paused_at.map_or(0.0, |start| now - start);
        now - self.started - self.total_paused() - open_pause
    }

    /// Where a frame captured at `captured` belongs in the video once the pauses are cut out, or
    /// `None` when it was captured during a pause.
    pub(super) fn video_time(&self, captured: f64) -> Option<f64> {
        if self.paused_at.is_some_and(|start| captured >= start) {
            return None;
        }
        let mut cut = 0.0;
        for &[start, end] in &self.pauses {
            if captured < start {
                break;
            }
            if captured < end {
                return None;
            }
            cut += end - start;
        }
        Some(captured - cut)
    }

    fn total_paused(&self) -> f64 {
        self.pauses.iter().map(|[start, end]| end - start).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_pause_should_be_cut_from_the_time_and_the_video() {
        let mut timeline = Timeline::new(10.0);
        assert_eq!(timeline.elapsed(12.0), 2.0);
        timeline.pause(12.0);
        timeline.resume(15.0);
        assert_eq!(timeline.elapsed(16.0), 3.0);
        // (captured at, place in the video): frames from the pause are dropped, the frame that
        // ends it is kept, and later frames close the gap.
        let frames = [
            (11.0, Some(11.0)),
            (13.0, None),
            (15.0, Some(12.0)),
            (16.0, Some(13.0)),
            (19.0, Some(16.0)),
        ];
        for (captured, video_time) in frames {
            assert_eq!(
                timeline.video_time(captured),
                video_time,
                "captured at {captured}"
            );
        }
        // While a pause is still open, frames before it stay and frames after it are dropped.
        timeline.pause(20.0);
        assert_eq!(timeline.video_time(19.0), Some(16.0));
        assert_eq!(timeline.video_time(21.0), None);
        assert_eq!(timeline.elapsed(22.0), 7.0);
    }

    #[test]
    fn several_pauses_should_add_up() {
        let mut timeline = Timeline::new(0.0);
        // Resuming without a pause changes nothing.
        timeline.resume(0.5);
        assert_eq!(timeline, Timeline::new(0.0));
        // A pause right at the start cuts the opening; pausing twice keeps the first start.
        timeline.pause(0.0);
        timeline.pause(1.0);
        timeline.resume(2.0);
        timeline.pause(5.0);
        timeline.resume(8.0);
        assert_eq!(timeline.pauses(), [[0.0, 2.0], [5.0, 8.0]]);
        assert_eq!(timeline.elapsed(10.0), 5.0);
        assert_eq!(timeline.video_time(0.0), None);
        assert_eq!(timeline.video_time(3.0), Some(1.0));
        assert_eq!(timeline.video_time(9.0), Some(4.0));
    }
}
