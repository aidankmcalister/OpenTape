import type { ReactNode } from "react";

export default function Header({
  name,
  children,
}: {
  name: string | null;
  children?: ReactNode;
}) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-title-bar shrink-0 items-center justify-between pr-4.5 pl-traffic-lights text-muted-foreground"
    >
      {name}
      {children}
    </header>
  );
}
