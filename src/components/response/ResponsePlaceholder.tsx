import { PanelRight } from "lucide-react";

export function ResponsePlaceholder() {
  return (
    <aside className="flex flex-col h-full bg-card border-l border-border">
      <div className="flex items-center gap-2 px-4 py-[10px] border-b border-border">
        <span
          className="text-[10px] font-semibold tracking-[0.6px] text-muted"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          RESPONSE
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 flex-1 text-muted">
        <PanelRight size={28} className="opacity-50" />
        <span className="text-[13px]" style={{ fontFamily: "var(--font-sans)" }}>
          Hit Send to see the response.
        </span>
      </div>
    </aside>
  );
}
