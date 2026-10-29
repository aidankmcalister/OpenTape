import type { UpdateStatus } from "@/lib/bindings";

export type News = "available" | "downloading" | "ready" | "failed";

export function newsOf(status: UpdateStatus): News | null {
  if (status.state === "failed")
    return status.version === null ? null : "failed";
  return status.state === "upToDate" || status.state === "checking"
    ? null
    : status.state;
}

export function downloadProgress(status: UpdateStatus) {
  if (status.state !== "downloading") return null;
  const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);
  const percent = status.total
    ? Math.min(100, Math.round((status.downloaded / status.total) * 100))
    : 0;
  return {
    percent,
    detail: `${megabytes(status.downloaded)} of ${megabytes(status.total)} MB`,
  };
}

export function whatIsNew(notes: string) {
  return notes
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*] /.test(line))
    .map((line) => line.slice(2));
}
