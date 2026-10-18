import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import KeyHint from "./KeyHint";

export default function RecordButton({
  size = "default",
  onClick,
}: {
  size?: "default" | "sm";
  onClick: () => void;
}) {
  return (
    <Button
      onClick={onClick}
      className={cn(
        "gap-2 rounded-full pr-2 text-[13px] text-white",
        size === "sm" ? "h-8 pl-3" : "h-10 pl-4",
      )}
    >
      Record
      <KeyHint>⏎</KeyHint>
    </Button>
  );
}
