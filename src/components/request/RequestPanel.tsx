import { useEffect } from "react";
import { useRequestStore } from "../../store/requestStore";
import { methodAllowsBody } from "../../lib/request-types";
import { UrlBar } from "./UrlBar";
import { RequestTabsStrip } from "./RequestTabsStrip";
import { ParamsTab } from "./ParamsTab";
import { HeadersTab } from "./HeadersTab";
import { BodyTab } from "./body/BodyTab";
import { AuthTab } from "./auth/AuthTab";
import { RequestEmpty } from "./RequestEmpty";

export function RequestPanel() {
  const activeId = useRequestStore((s) => s.activeId);
  const activeTab = useRequestStore((s) => (activeId ? s.openRequests[activeId]?.activeTab : null));
  const method = useRequestStore((s) => (activeId ? s.openRequests[activeId]?.method : undefined));
  const saveRequest = useRequestStore((s) => s.saveRequest);

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
