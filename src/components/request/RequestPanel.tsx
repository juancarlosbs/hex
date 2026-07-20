import { useEffect } from "react";
import { CornerDownLeft, X } from "lucide-react";
import { useRequestStore } from "../../store/requestStore";
import { useResponseStore } from "../../store/responseStore";
import { methodAllowsBody } from "../../lib/request-types";
import { UrlBar } from "./UrlBar";
import { RequestTabsStrip } from "./RequestTabsStrip";
import { ParamsTab } from "./ParamsTab";
import { HeadersTab } from "./HeadersTab";
import { BodyTab } from "./body/BodyTab";
import { AuthTab } from "./auth/AuthTab";
import { RequestEmpty } from "./RequestEmpty";
import { SchemaForm } from "./soap/SchemaForm";

export function RequestPanel() {
  const activeId = useRequestStore((s) => s.activeId);
  const activeTab = useRequestStore((s) => (activeId ? s.openRequests[activeId]?.activeTab : null));
  const method = useRequestStore((s) => (activeId ? s.openRequests[activeId]?.method : undefined));
  const req = useRequestStore((s) => (activeId ? s.openRequests[activeId] : undefined));
  const soap = req?.soap;
  const saveRequest = useRequestStore((s) => s.saveRequest);
  const setSoapValue = useRequestStore((s) => s.setSoapValue);
  const loading = useResponseStore((s) => (activeId ? s.responses[activeId]?.state === "loading" : false));
  const send = useResponseStore((s) => s.send);
  const cancel = useResponseStore((s) => s.cancel);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activeId) saveRequest(activeId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, saveRequest]);

  if (!activeId) return <RequestEmpty />;

  if (soap && req) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center justify-between gap-2 p-2 bg-card rounded-[8px] border border-border m-2">
          <span
            className="text-[13px] text-foreground truncate"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {req.name}
          </span>
          <button
            type="button"
            onClick={() => (loading ? cancel(req.id) : send(req))}
            className="flex items-center gap-2 px-5 py-[10px] rounded-[6px] bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer hover:opacity-90"
            style={{ fontFamily: "var(--font-sans)" }}
            title={loading ? "Cancel" : "Send (⌘↵)"}
          >
            {loading ? "Cancel" : "Send"}
            {loading ? <X size={14} /> : <CornerDownLeft size={14} />}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {soap.schema === null ? (
            <div className="p-3 text-[12px] text-muted">Loading schema…</div>
          ) : (
            <SchemaForm
              schema={soap.schema}
              value={soap.value}
              onChange={(next) => setSoapValue(activeId, next)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-2">
        <UrlBar requestId={activeId} />
      </div>
      <RequestTabsStrip requestId={activeId} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {(activeTab === "params" ||
          (activeTab === "body" && method !== undefined && !methodAllowsBody(method))) && (
          <ParamsTab requestId={activeId} />
        )}
        {activeTab === "body" && method !== undefined && methodAllowsBody(method) && (
          <BodyTab requestId={activeId} />
        )}
        {activeTab === "headers" && <HeadersTab requestId={activeId} />}
        {activeTab === "auth" && <AuthTab requestId={activeId} />}
      </div>
    </div>
  );
}
