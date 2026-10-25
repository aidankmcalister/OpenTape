import { useState } from "react";
import type { RegionKind } from "@/lib/editor/regions";

export function useLanes() {
  const [solo, setSolo] = useState<RegionKind | null>(null);
  const [collapsed, setCollapsed] = useState<RegionKind[]>([]);
  return {
    solo,
    collapsed,
    toggleSolo: (kind: RegionKind) =>
      setSolo((current) => (current === kind ? null : kind)),
    toggleCollapsed: (kind: RegionKind) =>
      setCollapsed((current) =>
        current.includes(kind)
          ? current.filter((other) => other !== kind)
          : [...current, kind],
      ),
  };
}

export type Lanes = ReturnType<typeof useLanes>;
