import { ArrowUp, CircleAlert, RotateCw } from "lucide-react";
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
  const Icon =
    news === "failed" ? CircleAlert : news === "ready" ? RotateCw : ArrowUp;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full [&_svg]:size-4",
        news === "failed"
          ? "bg-destructive/16 text-destructive"
          : "bg-primary-tint text-primary-tint-foreground",
        className,
      )}
    >
      {news === "downloading" ? (
        <ProgressRing fraction={percent / 100} className="size-5" />
      ) : (
        <Icon />
      )}
    </span>
  );
}
