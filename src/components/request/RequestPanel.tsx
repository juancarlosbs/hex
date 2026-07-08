import { useRequestStore } from "../../store/requestStore";
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

  if (!activeId) return <RequestEmpty />;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-2">
        <UrlBar requestId={activeId} />
      </div>
      <RequestTabsStrip requestId={activeId} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "params" && <ParamsTab requestId={activeId} />}
        {activeTab === "body" && <BodyTab requestId={activeId} />}
        {activeTab === "headers" && <HeadersTab requestId={activeId} />}
        {activeTab === "auth" && <AuthTab requestId={activeId} />}
      </div>
    </div>
  );
}
