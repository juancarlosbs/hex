import { useEffect, useState } from "react";
import { useRequestStore } from "../../store/requestStore";
import { methodAllowsBody } from "../../lib/request-types";
import { UrlBar } from "./UrlBar";
import { SoapUrlBar } from "./soap/SoapUrlBar";
import { SoapAutoMeta } from "./soap/SoapAutoMeta";
import { SoapRequestTabs, type SoapBodyView } from "./soap/SoapRequestTabs";
import { SoapXmlBody } from "./soap/SoapXmlBody";
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
  const setSoapXmlDraft = useRequestStore((s) => s.setSoapXmlDraft);
  const commitSoapXml = useRequestStore((s) => s.commitSoapXml);
  const [soapView, setSoapView] = useState<SoapBodyView>("form");
  const [xmlSyncError, setXmlSyncError] = useState<string | null>(null);

  function onSoapViewChange(next: SoapBodyView) {
    // Leaving the XML tab: parse the draft back into the form (raw fallback on failure).
    if (next === "form" && soapView === "xml" && activeId) {
      commitSoapXml(activeId).then(setXmlSyncError);
    }
    setSoapView(next);
  }

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
        <SoapUrlBar requestId={req.id} />
        <SoapAutoMeta requestId={req.id} />
        <SoapRequestTabs requestId={req.id} view={soapView} onViewChange={onSoapViewChange} />
        <div className="flex-1 min-h-0">
          {soap.schema === null ? (
            <div className="p-3 text-[12px] text-muted">Loading schema…</div>
          ) : soapView === "form" ? (
            <div className="h-full flex flex-col">
              {soap.xmlDraft !== null && (
                <div
                  className="flex items-center gap-2 px-3 py-2 text-[12px] border-b border-border shrink-0"
                  style={{ background: "var(--color-soap-op-surface)" }}
                >
                  <span style={{ color: "var(--color-soap-op)" }}>
                    Sending hand-edited XML{xmlSyncError ? `: ${xmlSyncError}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSoapXmlDraft(activeId, null);
                      setXmlSyncError(null);
                    }}
                    className="ml-auto text-[12px] font-semibold cursor-pointer hover:underline"
                    style={{ color: "var(--color-soap-op)" }}
                  >
                    Reset to form
                  </button>
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <SchemaForm
                  schema={soap.schema}
                  value={soap.value}
                  onChange={(next) => setSoapValue(activeId, next)}
                />
              </div>
            </div>
          ) : (
            <SoapXmlBody requestId={req.id} />
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
