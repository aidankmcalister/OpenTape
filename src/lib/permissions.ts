import type { Access, Permissions } from "@/lib/bindings";

export function isOn(access: Access) {
  return access === "allowed" || access === "needsRestart";
}

export function setupProgress(permissions: Permissions, recordsKeys = false) {
  const accesses = [
    permissions.screenRecording,
    permissions.microphone,
    ...(recordsKeys ? [permissions.inputMonitoring] : []),
  ];
  const isAllSet = accesses.every((access) => access === "allowed");
  const isReminder =
    permissions.hasFinishedSetup && permissions.screenRecording !== "allowed";
  const needsRestart =
    permissions.screenRecording === "needsRestart" ||
    (recordsKeys && permissions.inputMonitoring === "needsRestart");
  const action = needsRestart ? "restart" : isAllSet ? "done" : "continue";
  return {
    isAllSet,
    isReminder,
    action,
    canAct: action !== "continue" || permissions.screenRecording === "allowed",
  } as const;
}
