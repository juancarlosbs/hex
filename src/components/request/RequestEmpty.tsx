import { Hexagon } from "lucide-react";

export function RequestEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-full text-muted">
      <Hexagon size={32} className="text-muted opacity-50" />
      <span className="text-[13px]" style={{ fontFamily: "var(--font-sans)" }}>
        Select a request from the sidebar or create a new one.
      </span>
    </div>
  );
}
