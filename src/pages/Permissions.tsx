import type { ComponentType } from "react";
import { Check, Mic, Monitor, RotateCcw } from "lucide-react";
import appIcon from "@/assets/app-icon.svg";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { useShowWhenReady } from "@/hooks/useTauri";
import type { Access, Permission } from "@/lib/bindings";
import { isOn, setupProgress } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ROWS: {
  permission: Permission;
  name: string;
  Icon: ComponentType;
}[] = [
  { permission: "screenRecording", name: "Screen Recording", Icon: Monitor },
  { permission: "microphone", name: "Microphone", Icon: Mic },
];

export default function Permissions() {
  const { permissions, allow, finish, restart } = usePermissions();
  useShowWhenReady();
  const progress = permissions && setupProgress(permissions);
  const title = progress?.isAllSet
    ? "You are all set"
    : progress?.isReminder
      ? "Screen Recording is off"
      : "Set up OpenTape";

  return (
    <main
      data-tauri-drag-region
      className="flex h-screen flex-col gap-6 bg-card px-6 pt-12 pb-6 text-foreground select-none"
    >
      <header
        data-tauri-drag-region
        className="flex flex-col items-center gap-4"
      >
        <img src={appIcon} alt="" className="size-12" />
        <div
          data-tauri-drag-region
          className="flex flex-col items-center gap-1"
        >
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-ui text-muted-foreground">
            Give OpenTape the proper permissions
          </p>
        </div>
      </header>
      <section className="flex flex-col gap-2">
        {ROWS.map(({ permission, ...row }) => (
          <PermissionRow
            key={permission}
            {...row}
            access={permissions?.[permission] ?? null}
            isRequired={permission === "screenRecording"}
            onAllow={() => allow(permission)}
          />
        ))}
      </section>
      <Button
        variant="primary"
        size="pill"
        className="w-full"
        disabled={!progress?.canAct}
        onClick={progress?.action === "restart" ? restart : finish}
      >
        {progress?.action === "restart" ? (
          <>
            <RotateCcw />
            Restart OpenTape
          </>
        ) : progress?.action === "done" ? (
          "Done"
        ) : (
          "Continue"
        )}
      </Button>
    </main>
  );
}

function PermissionRow({
  name,
  Icon,
  access,
  isRequired,
  onAllow,
}: {
  name: string;
  Icon: ComponentType;
  access: Access | null;
  isRequired: boolean;
  onAllow: () => void;
}) {
  const isAllowed = access !== null && isOn(access);
  const isOff = access === "off";
  return (
    <div className="flex h-14 items-center gap-3 rounded-xl bg-muted px-2 ring-1 ring-hairline">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full bg-accent text-muted-foreground [&_svg]:size-4",
          isAllowed && "bg-success-tint text-success",
          isOff && "bg-destructive/16 text-destructive",
        )}
      >
        <Icon />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-ui font-medium">
        {name}
        {isRequired ? (
          <span className="rounded-full bg-accent px-1.5 text-micro text-muted-foreground">
            Required
          </span>
        ) : null}
      </span>
      {access === null ? (
        <span className="h-8 w-28 rounded-full bg-accent/60" />
      ) : isAllowed ? (
        <span className="flex h-8 items-center gap-1.5 rounded-full bg-success-tint px-4 text-ui text-success fade-in [&_svg]:size-3.5">
          <Check />
          Allowed
        </span>
      ) : (
        <Button
          variant="secondary"
          size="pill-sm"
          className="fade-in"
          onClick={onAllow}
        >
          Open Settings
        </Button>
      )}
    </div>
  );
}
