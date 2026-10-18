/** WebKit draws nothing until a video plays or seeks, so this seeks away and back to the start. */
export function showFirstFrame(video: HTMLVideoElement) {
  video.addEventListener("seeked", () => (video.currentTime = 0), {
    once: true,
  });
  video.currentTime = Math.min(0.1, video.duration / 2);
}
