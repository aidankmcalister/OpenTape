/** Drags the window. The name starts after macOS's traffic lights. */
export default function Header({ name }: { name: string | null }) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-title-bar shrink-0 items-center pl-traffic-lights text-muted-foreground"
    >
      {name}
    </header>
  );
}
