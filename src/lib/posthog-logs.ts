import posthog, { isPostHogConfigured } from "@/lib/posthog";

export const posthogLog = {
  recordingStarted(targetType: string) {
    if (!isPostHogConfigured) return;
    posthog.logger.info("recording started", { target_type: targetType });
  },
  recordingAction(
    action: "recording_paused" | "recording_resumed" | "recording_restarted",
  ) {
    if (!isPostHogConfigured) return;
    const messages = {
      recording_paused: "recording paused",
      recording_resumed: "recording resumed",
      recording_restarted: "recording restarted",
    };
    posthog.logger.info(messages[action]);
  },
  exportCompleted(destination: "file" | "clipboard") {
    if (!isPostHogConfigured) return;
    posthog.logger.info("recording export completed", { destination });
  },
};
