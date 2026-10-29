import type { ComponentType } from "react";
import { Check, ExternalLink, Mic, Monitor, RotateCcw } from "lucide-react";
import appIcon from "@/assets/app-icon.svg";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import type { Access, Permission } from "@/lib/bindings";
import { isOn, setupProgress } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ROWS: {
  permission: Permission;
  name: string;
  purpose: string;
  Icon: ComponentType;
}[] = [
  {
    permission: "screenRecording",
    name: "Screen Recording",
    purpose: "Record your screen and system sound.",
    Icon: Monitor,
  },
  {
    permission: "microphone",
    name: "Microphone",
    purpose: "Record your voice with the screen.",
    Icon: Mic,
  },
];

export default function Permissions() {
  const { permissions, opened, allow, finish, restart } = usePermissions();
  if (!permissions) return null;
  const progress = setupProgress(permissions);
  const [title, subtitle] = progress.isAllSet
    ? ["You are all set", "OpenTape can now record your screen and voice."]
    : progress.isReminder
      ? ["Screen Recording is off", "OpenTape needs it to record your screen."]
      : [
          "Set up OpenTape",
          "OpenTape needs a few permissions from macOS. Nothing leaves your Mac.",
        ];

  return (
    <main className="flex h-screen flex-col bg-card text-foreground select-none">
      <header
        data-tauri-drag-region
        className="flex gap-4 px-6 pt-title-bar pb-6"
      >
        <img src={appIcon} alt="" className="size-12 shrink-0" />
        <div data-tauri-drag-region className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-ui text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      <section className="flex flex-1 flex-col gap-2 px-6">
        {ROWS.map(({ permission, ...row }) => (
          <PermissionRow
            key={permission}
            {...row}
            access={permissions[permission]}
            isRequired={permission === "screenRecording"}
            isOutlined={progress.isReminder && permission === "screenRecording"}
            isWaiting={opened.includes(permission)}
            onAllow={() => allow(permission)}
          />
        ))}
        <p className="pt-2 text-xs text-muted-foreground">
          {progress.isAllSet
            ? "Change either of these later in System Settings."
            : "Only Screen Recording is required. You can turn on the microphone later."}
        </p>
      </section>
      <footer className="flex h-18 shrink-0 items-center justify-between border-t border-hairline px-6">
        <span className="text-xs text-muted-foreground">
          {progress.allowed} of {progress.total} allowed
        </span>
        <Button
          variant="primary"
          size="pill"
          disabled={!progress.canAct}
          onClick={progress.action === "restart" ? restart : finish}
        >
          {progress.action === "restart" ? (
            <>
              <RotateCcw />
              Restart OpenTape
            </>
          ) : progress.action === "done" ? (
            "Done"
          ) : (
            "Continue"
          )}
        </Button>
      </footer>
    </main>
  );
}

function PermissionRow({
  name,
  purpose,
  Icon,
  access,
  isRequired,
  isOutlined,
  isWaiting,
  onAllow,
}: {
  name: string;
  purpose: string;
  Icon: ComponentType;
  access: Access;
  isRequired: boolean;
  isOutlined: boolean;
  isWaiting: boolean;
  onAllow: () => void;
}) {
  const isAllowed = isOn(access);
  const isOff = access === "off";
  const note =
    access === "needsRestart"
      ? "Restart OpenTape to start recording."
      : isOff
        ? "Turned off. Turn it on in System Settings."
        : isWaiting && !isAllowed
          ? "Turn on OpenTape in System Settings."
          : purpose;
  return (
    <div
      className={cn(
        "flex h-16 items-center gap-3 rounded-xl bg-muted px-3",
        isOutlined && "ring-1 ring-highlight",
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full bg-accent text-muted-foreground [&_svg]:size-4",
          isAllowed && "bg-success-tint text-success",
          isOff && "bg-destructive/16 text-destructive",
        )}
      >
        <Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-ui font-medium">
          {name}
          {isRequired ? (
            <span className="rounded-full bg-accent px-1.5 text-micro text-muted-foreground">
              Required
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "truncate text-xs text-muted-foreground",
            isOff && "text-destructive",
          )}
        >
          {note}
        </span>
      </span>
      {isAllowed ? (
        <span className="flex h-8 items-center gap-1.5 rounded-full bg-success-tint px-4 text-ui text-success fade-in [&_svg]:size-3.5">
          <Check />
          Allowed
        </span>
      ) : (
        <Button variant="secondary" size="pill-sm" onClick={onAllow}>
          <ExternalLink />
          Open Settings
        </Button>
      )}
    </div>
  );
}
