import { useEffect, useState } from "react";
import { listDevices } from "@/features/bar/lib/bar";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import type { Device } from "@/lib/bindings/Device";
import type { Devices } from "@/lib/bindings/Devices";
import { popupChoices } from "@/lib/menus";

type Options = {
  cameraId: string | null;
  microphoneId: string | null;
  systemAudio: boolean;
};

export type CaptureOptions = {
  /** Null when off, or when the chosen device is unplugged. */
  camera: Device | null;
  microphone: Device | null;
  systemAudio: boolean;
  chooseCamera: (anchor: HTMLElement) => Promise<void>;
  chooseMicrophone: (anchor: HTMLElement) => Promise<void>;
  toggleSystemAudio: () => void;
};

const STORAGE_KEY = "capture-options";
const DEVICE_MENUS = {
  cameras: { key: "cameraId", none: "No camera" },
  microphones: { key: "microphoneId", none: "No microphone" },
} as const;
const DEFAULTS: Options = {
  cameraId: null,
  microphoneId: null,
  systemAudio: false,
};

/** The camera, microphone and system audio choices, remembered between launches. */
export function useCaptureOptions(): CaptureOptions {
  const [devices, setDevices] = useState<Devices>({
    cameras: [],
    microphones: [],
  });
  const [options, setOptions] = useState<Options>(loadOptions);
  const oneAtATime = useOneAtATime();

  useEffect(() => {
    let isMounted = true;
    listDevices()
      .then((found) => {
        if (isMounted) setDevices(found);
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, []);
  useEffect(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(options)),
    [options],
  );

  const update = (patch: Partial<Options>) =>
    setOptions((current) => ({ ...current, ...patch }));

  /** One menu at a time, so a double click doesn't open a second after the first. */
  async function chooseDevice(anchor: HTMLElement, kind: keyof Devices) {
    const { key, none } = DEVICE_MENUS[kind];
    await oneAtATime(async () => {
      const found = await listDevices();
      setDevices(found);
      await popupChoices(
        anchor,
        withNone(none, found[kind]),
        options[key],
        (id) => update({ [key]: id }),
      );
    }).catch(console.error);
  }

  return {
    camera: devices.cameras.find(({ id }) => id === options.cameraId) ?? null,
    microphone:
      devices.microphones.find(({ id }) => id === options.microphoneId) ?? null,
    systemAudio: options.systemAudio,
    chooseCamera: (anchor) => chooseDevice(anchor, "cameras"),
    chooseMicrophone: (anchor) => chooseDevice(anchor, "microphones"),
    toggleSystemAudio: () =>
      setOptions((current) => ({
        ...current,
        systemAudio: !current.systemAudio,
      })),
  };
}

function withNone(noneLabel: string, devices: Device[]) {
  return [
    { value: null, label: noneLabel },
    ...devices.map(({ id, name }) => ({
      value: id as string | null,
      label: name,
    })),
  ];
}

function loadOptions(): Options {
  try {
    return {
      ...DEFAULTS,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"),
    };
  } catch {
    return DEFAULTS;
  }
}
