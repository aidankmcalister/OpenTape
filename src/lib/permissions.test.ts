import { expect, test } from "bun:test";
import type { Access, Permissions } from "@/lib/bindings";
import { isOn, setupProgress } from "./permissions";

function permissions(
  screenRecording: Access,
  microphone: Access,
  hasFinishedSetup = false,
): Permissions {
  return {
    screenRecording,
    microphone,
    inputMonitoring: "notAsked",
    hasFinishedSetup,
  };
}

test("nothing allowed on first launch can't continue yet", () => {
  expect(setupProgress(permissions("notAsked", "notAsked"))).toEqual({
    isAllSet: false,
    isReminder: false,
    action: "continue",
    canAct: false,
  });
});

test("Screen Recording turned on before a restart counts as allowed and asks for the restart", () => {
  const progress = setupProgress(permissions("needsRestart", "notAsked"));
  expect(isOn("needsRestart")).toBe(true);
  expect(progress.action).toBe("restart");
});

test("Screen Recording alone is enough to continue", () => {
  const progress = setupProgress(permissions("allowed", "off"));
  expect(progress.action).toBe("continue");
  expect(progress.canAct).toBe(true);
});

test("both allowed is done", () => {
  const progress = setupProgress(permissions("allowed", "allowed"));
  expect(progress.isAllSet).toBe(true);
  expect(progress.action).toBe("done");
});

test("Screen Recording off after setup is a reminder", () => {
  expect(
    setupProgress(permissions("notAsked", "allowed", true)).isReminder,
  ).toBe(true);
  expect(
    setupProgress(permissions("allowed", "notAsked", true)).isReminder,
  ).toBe(false);
});

test("Input Monitoring counts only when recording keys", () => {
  const keysOff = permissions("allowed", "allowed");
  expect(setupProgress(keysOff).action).toBe("done");
  expect(setupProgress(keysOff, true).action).toBe("continue");
  const restart = { ...keysOff, inputMonitoring: "needsRestart" as const };
  expect(setupProgress(restart).action).toBe("done");
  expect(setupProgress(restart, true).action).toBe("restart");
  const allowed = { ...keysOff, inputMonitoring: "allowed" as const };
  expect(setupProgress(allowed, true).action).toBe("done");
});
