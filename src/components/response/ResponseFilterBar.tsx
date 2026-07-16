import { Filter } from "lucide-react";
import { cn } from "../../lib/utils";
import { ResponseBodyView } from "../../lib/response-types";

interface ResponseFilterBarProps {
  view: ResponseBodyView;
  onViewChange: (view: ResponseBodyView) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
}

export function ResponseFilterBar({ view, onViewChange, filter, onFilterChange }: ResponseFilterBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-[10px] border-b border-border shrink-0">
      <div className="flex items-center gap-[7px] flex-1 bg-background border border-border rounded-md px-[9px] py-[6px]">
        <Filter size={12} className="text-muted shrink-0" />
        <input
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="$.data.user.email"
          className="flex-1 bg-transparent text-[12px] text-muted outline-none placeholder:text-muted/50"
          style={{ fontFamily: "var(--font-mono)" }}
        />
      </div>
      <ViewToggle view={view} onViewChange={onViewChange} />
    </div>
  );
}

function ViewToggle({ view, onViewChange }: { view: ResponseBodyView; onViewChange: (v: ResponseBodyView) => void }) {
  return (
    <div className="flex items-center gap-[2px] bg-background border border-border rounded-md p-[2px] shrink-0">
      {(["tree", "raw"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onViewChange(v)}
          className={cn(
            "px-[10px] py-1 rounded text-[11px] font-medium cursor-pointer capitalize",
            view === v ? "bg-secondary text-foreground" : "text-muted hover:text-foreground",
          )}
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {v === "tree" ? "Tree" : "Raw"}
        </button>
      ))}
    </div>
  );
}
