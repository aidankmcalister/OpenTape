import type { Access, Permissions } from "@/lib/bindings";

export function isOn(access: Access) {
  return access === "allowed" || access === "needsRestart";
}

export function setupProgress(permissions: Permissions) {
  const accesses = [permissions.screenRecording, permissions.microphone];
  const allowed = accesses.filter(isOn).length;
  const isAllSet = accesses.every((access) => access === "allowed");
  const isReminder =
    permissions.hasFinishedSetup && permissions.screenRecording !== "allowed";
  const action =
    permissions.screenRecording === "needsRestart"
      ? "restart"
      : isAllSet
        ? "done"
        : "continue";
  return {
    allowed,
    total: accesses.length,
    isAllSet,
    isReminder,
    action,
    canAct: action !== "continue" || permissions.screenRecording === "allowed",
  } as const;
}
