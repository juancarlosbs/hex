import { cn } from "../../lib/utils";
import { ResponseTab } from "../../lib/response-types";

const TABS: { key: ResponseTab; label: string }[] = [
  { key: "body", label: "Body" },
  { key: "headers", label: "Headers" },
  { key: "timing", label: "Timing" },
];

interface ResponseTabsStripProps {
  activeTab: ResponseTab;
  onTabChange: (tab: ResponseTab) => void;
}

export function ResponseTabsStrip({ activeTab, onTabChange }: ResponseTabsStripProps) {
  return (
    <div className="flex items-center gap-1 px-3 border-b border-border shrink-0">
      {TABS.map(({ key, label }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={cn(
              "py-3 px-[10px] border-b-2 cursor-pointer text-[13px] font-medium",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
