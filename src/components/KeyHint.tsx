import { Kbd } from "@/components/ui/kbd";

/** The key that triggers an action, shown next to it. */
export default function KeyHint({ children }: { children: string }) {
  return (
    <Kbd className="h-4 min-w-5 rounded-[4px] bg-white/10 px-1 text-[11px] text-muted-foreground">
      {children}
    </Kbd>
  );
}
