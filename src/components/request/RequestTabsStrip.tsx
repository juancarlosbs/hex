// src/components/request/RequestTabsStrip.tsx
import { RequestTab } from "../../lib/request-types";
import { useRequestStore } from "../../store/requestStore";

const TABS: { key: RequestTab; label: string }[] = [
  { key: "params", label: "Params" },
  { key: "body", label: "Body" },
  { key: "headers", label: "Headers" },
  { key: "auth", label: "Auth" },
];

interface RequestTabsStripProps {
  requestId: string;
}

export function RequestTabsStrip({ requestId }: RequestTabsStripProps) {
  const active = useRequestStore((s) => s.openRequests[requestId]?.activeTab);
  const params = useRequestStore((s) => s.openRequests[requestId]?.params.length ?? 0);
  const headers = useRequestStore((s) => s.openRequests[requestId]?.headers.length ?? 0);
  const setActiveTab = useRequestStore((s) => s.setActiveTab);

  const count = (k: RequestTab) => (k === "params" ? params : k === "headers" ? headers : 0);

  return (
    <div className="flex items-center gap-4 px-3 border-b border-border">
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(requestId, t.key)}
            className={`flex items-center gap-[6px] py-3 border-b-2 cursor-pointer ${
              isActive ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <span className="text-[13px] font-medium">{t.label}</span>
            {count(t.key) > 0 && (
              <span className="text-[10px] px-[5px] py-[1px] rounded-full bg-secondary text-muted">
                {count(t.key)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
