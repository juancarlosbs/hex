import { cn } from "../../../lib/utils";
import type { RequestTab } from "../../../lib/request-types";
import { useRequestStore } from "../../../store/requestStore";

export type SoapBodyView = "form" | "xml";

interface SoapRequestTabsProps {
  requestId: string;
  view: SoapBodyView;
  onViewChange: (view: SoapBodyView) => void;
}

const TABS: { key: RequestTab; label: string; disabled?: boolean }[] = [
  { key: "headers", label: "Headers", disabled: true },
  { key: "body", label: "Body" },
  { key: "auth", label: "Auth", disabled: true },
];

/** SOAP has no Params tab — anything else falls back to Body. */
export function soapActiveTab(tab: RequestTab): RequestTab {
  return tab === "headers" || tab === "auth" ? tab : "body";
}

export function SoapRequestTabs({ requestId, view, onViewChange }: SoapRequestTabsProps) {
  const activeTab = useRequestStore((s) => s.openRequests[requestId]?.activeTab ?? "body");
  const setActiveTab = useRequestStore((s) => s.setActiveTab);
  const active = soapActiveTab(activeTab);

  return (
    <div className="flex items-center justify-between px-3 border-b border-border">
      <div className="flex items-center gap-[2px]">
        {TABS.map(({ key, label, disabled }) => {
          const on = active === key;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => setActiveTab(requestId, key)}
              className={cn(
                "px-3 pt-3 pb-[11px] text-[13px] border-b-2 border-transparent",
                disabled
                  ? "text-muted opacity-40 cursor-not-allowed"
                  : on
                    ? "font-semibold text-foreground cursor-pointer"
                    : "text-muted cursor-pointer",
              )}
              style={{ fontFamily: "var(--font-sans)", borderBottomColor: on ? "var(--color-soap-op)" : undefined }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center rounded-[6px] border border-border bg-secondary">
        {(["form", "xml"] as const).map((v) => {
          const on = view === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              className={cn(
                "px-3 py-[6px] text-[12px] font-semibold rounded-[6px] cursor-pointer",
                on ? "text-white" : "text-muted",
              )}
              style={{ fontFamily: "var(--font-sans)", background: on ? "var(--color-soap-op)" : undefined }}
            >
              {v === "form" ? "Form" : "XML"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
