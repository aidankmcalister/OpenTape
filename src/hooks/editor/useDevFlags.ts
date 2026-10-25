import { useState } from "react";

const KEY = "screen-recorder:dev-flags";

export function useDevFlags() {
  const [previewTypes, setPreviewTypes] = useState(read);
  return {
    previewTypes,
    setPreviewTypes: (isOn: boolean) => {
      setPreviewTypes(isOn);
      try {
        localStorage.setItem(KEY, JSON.stringify({ previewTypes: isOn }));
      } catch {
        return;
      }
    },
  };
}

export type Dev = ReturnType<typeof useDevFlags>;

function read(): boolean {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}").previewTypes === true;
  } catch {
    return false;
  }
}
