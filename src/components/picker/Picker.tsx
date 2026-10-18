import { useFraming, usePicker } from "@/hooks/usePicker";
import { record } from "@/lib/picker";
import AreaBox from "./AreaBox";
import DimOutside from "./DimOutside";
import Highlight from "./Highlight";

export default function Picker({ displayId }: { displayId: number }) {
  const view = usePicker(displayId);
  const framing = useFraming();
  if (framing.window) {
    return (
      <div className="fixed inset-0">
        <DimOutside rect={framing.window} />
      </div>
    );
  }
  if (!view) return null;
  if (view.mode === "area") {
    return (
      <AreaBox
        display={view.display}
        hasBox={view.hasBox}
        isFraming={framing.isFraming}
      />
    );
  }
  const { highlight } = view;
  if (!highlight) return <div className="fixed inset-0 bg-dim" />;
  return (
    <Highlight
      highlight={highlight}
      onRecord={() => void record(highlight.target)}
    />
  );
}
