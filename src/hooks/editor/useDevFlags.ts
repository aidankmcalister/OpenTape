import { useEffect, useState } from "react";

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

export function useMostRows(rows: number) {
  const [mostRows, setMostRows] = useState(rows);
  if (rows > mostRows) setMostRows(rows);
  useEffect(() => {
    console.info(`Most overlapping modifier rows this session: ${mostRows}`);
  }, [mostRows]);
  return mostRows;
}

function read(): boolean {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}").previewTypes === true;
  } catch {
    return false;
  }
}
