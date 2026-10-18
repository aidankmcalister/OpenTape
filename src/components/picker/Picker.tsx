import { usePicker } from "@/hooks/usePicker";
import { pick } from "@/lib/picker";
import AreaBox from "./AreaBox";
import Highlight from "./Highlight";

export default function Picker({ displayId }: { displayId: number }) {
  const view = usePicker(displayId);
  if (!view) return null;
  if (view.mode === "area") {
    return <AreaBox display={view.display} startsHere={view.startsHere} />;
  }
  const { highlight } = view;
  if (!highlight) return <div className="fixed inset-0 bg-dim" />;
  return (
    <Highlight
      highlight={highlight}
      onRecord={() => void pick(highlight.target)}
    />
  );
}
