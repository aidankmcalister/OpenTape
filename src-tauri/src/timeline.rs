//! A recording's time, with its pauses cut out. All times are seconds on the host clock, the
//! clock ScreenCaptureKit stamps frames with, so frames and the record bar's timer agree.

#[derive(Debug, Clone, PartialEq)]
pub struct Timeline {
    started: f64,
    /// Finished pauses, as `[start, end]`, oldest first.
    pauses: Vec<[f64; 2]>,
    paused_at: Option<f64>,
}

impl Timeline {
    pub fn new(started: f64) -> Self {
        Self {
            started,
            pauses: Vec::new(),
            paused_at: None,
        }
    }

    pub fn pauses(&self) -> &[[f64; 2]] {
        &self.pauses
    }

    pub fn pause(&mut self, now: f64) {
        self.paused_at.get_or_insert(now);
    }

    pub fn resume(&mut self, now: f64) {
        if let Some(start) = self.paused_at.take() {
            self.pauses.push([start, now]);
        }
    }

    /// How long has been recorded by `now`, not counting pauses.
    pub fn elapsed(&self, now: f64) -> f64 {
        let open_pause = self.paused_at.map_or(0.0, |start| now - start);
        now - self.started - self.paused_total() - open_pause
    }

    /// Where a frame captured at `time` belongs once the pauses are cut out, or `None` when it
    /// was captured during a pause.
    pub fn place(&self, time: f64) -> Option<f64> {
        if self.paused_at.is_some_and(|start| time >= start) {
            return None;
        }
        let mut cut = 0.0;
        for &[start, end] in &self.pauses {
            if time < start {
                break;
            }
            if time < end {
                return None;
            }
            cut += end - start;
        }
        Some(time - cut)
    }

    fn paused_total(&self) -> f64 {
        self.pauses.iter().map(|[start, end]| end - start).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paused_from_12_to_15() -> Timeline {
        let mut timeline = Timeline::new(10.0);
        timeline.pause(12.0);
        timeline.resume(15.0);
        timeline
    }

    #[test]
    fn elapsed_should_leave_out_pauses() {
        let mut timeline = paused_from_12_to_15();
        assert_eq!(timeline.elapsed(16.0), 3.0);
        timeline.pause(17.0);
        assert_eq!(timeline.elapsed(20.0), 4.0);
    }

    #[test]
    fn place_should_close_the_gap_a_pause_leaves() {
        let timeline = paused_from_12_to_15();
        assert_eq!(timeline.place(11.0), Some(11.0));
        assert_eq!(timeline.place(16.0), Some(13.0));
    }

    #[test]
    fn place_should_drop_frames_captured_while_paused() {
        let mut timeline = paused_from_12_to_15();
        assert_eq!(timeline.place(13.0), None);
        timeline.pause(20.0);
        assert_eq!(timeline.place(21.0), None);
    }

    #[test]
    fn pausing_twice_should_keep_the_first_start() {
        let mut timeline = Timeline::new(0.0);
        timeline.pause(1.0);
        timeline.pause(2.0);
        timeline.resume(3.0);
        assert_eq!(timeline.elapsed(3.0), 1.0);
    }
}
