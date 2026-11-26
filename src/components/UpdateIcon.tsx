import { ArrowUp, Check, CircleAlert, RotateCw } from "lucide-react";
import { ProgressRing } from "@/components/Pill";
import type { News } from "@/lib/update";
import { cn } from "@/lib/utils";

export default function UpdateIcon({
  news,
  percent = 0,
  className,
}: {
  news: News;
  percent?: number;
  className?: string;
}) {
  const isFailed = news === "failed" || news === "checkFailed";
  const Icon = isFailed
    ? CircleAlert
    : news === "ready"
      ? RotateCw
      : news === "upToDate"
        ? Check
        : ArrowUp;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        isFailed
          ? "bg-destructive/16 text-destructive"
          : news === "upToDate"
            ? "bg-success-tint text-success"
            : "bg-primary-tint text-primary-tint-foreground",
        className,
      )}
    >
      {news === "downloading" ? (
        <ProgressRing fraction={percent / 100} className="size-5" />
      ) : news === "checking" ? (
        <ProgressRing fraction={0.25} className="size-5 animate-spin" />
      ) : (
        <Icon className="size-4" />
      )}
    </span>
  );
}
