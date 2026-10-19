//! `meta.json`, written next to each recording: the video size, where it was on screen, and
//! the clock times needed to line the cursor log up with the video.

use super::plan::CapturePlan;

pub(super) fn meta_json(plan: &CapturePlan, first_frame_time: f64, pauses: &[[f64; 2]]) -> String {
    let rect = plan.screen_rect;
    let first_frame = format!("{first_frame_time:.6}");
    // Can't fail: plain numbers always serialize.
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
