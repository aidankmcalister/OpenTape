import { useEffect, useState } from "react";
import { listDevices, type Device, type Devices } from "@/lib/devices";
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

  useEffect(() => void refreshDevices(), []);
  useEffect(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(options)),
    [options],
  );

  async function refreshDevices(): Promise<Devices> {
    const found = await listDevices();
    setDevices(found);
    return found;
  }

  const update = (patch: Partial<Options>) =>
    setOptions((current) => ({ ...current, ...patch }));

  return {
    camera: devices.cameras.find(({ id }) => id === options.cameraId) ?? null,
    microphone:
      devices.microphones.find(({ id }) => id === options.microphoneId) ?? null,
    systemAudio: options.systemAudio,
    chooseCamera: async (anchor) => {
      const { cameras } = await refreshDevices();
      await popupChoices(
        anchor,
        withNone("No camera", cameras),
        options.cameraId,
        (cameraId) => update({ cameraId }),
      );
    },
    chooseMicrophone: async (anchor) => {
      const { microphones } = await refreshDevices();
      await popupChoices(
        anchor,
        withNone("No microphone", microphones),
        options.microphoneId,
        (microphoneId) => update({ microphoneId }),
      );
    },
    toggleSystemAudio: () => update({ systemAudio: !options.systemAudio }),
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
