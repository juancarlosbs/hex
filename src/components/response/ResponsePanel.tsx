import { useState } from "react";
import { Loader2, CircleAlert } from "lucide-react";
import { ResponseBodyView as BodyViewKind, ResponseTab } from "../../lib/response-types";
import { ResponsePlaceholder } from "./ResponsePlaceholder";
import { ResponseStatusBar } from "./ResponseStatusBar";
import { ResponseTabsStrip } from "./ResponseTabsStrip";
import { ResponseFilterBar } from "./ResponseFilterBar";
import { ResponseBodyView as BodyView } from "./body/ResponseBodyView";
import { Waterfall } from "./Waterfall";
import { useRequestStore } from "../../store/requestStore";
import { useResponseStore } from "../../store/responseStore";

export function ResponsePanel() {
  const activeId = useRequestStore((s) => s.activeId);
  const entry = useResponseStore((s) => (activeId ? s.responses[activeId] : undefined));
  const [activeTab, setActiveTab] = useState<ResponseTab>("body");
  const [bodyView, setBodyView] = useState<BodyViewKind>("tree");
  const [filter, setFilter] = useState("");

  if (!entry) return <ResponsePlaceholder />;
  if (entry.state === "loading") return <LoadingView />;
  if (entry.state === "error") return <ErrorView message={entry.error} />;

  const response = entry.response;

  return (
    <aside className="flex flex-col h-full bg-card border-l border-border">
      <ResponseStatusBar response={response} />
      <ResponseTabsStrip activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab === "body" && (
        <>
          <ResponseFilterBar
            view={bodyView}
            onViewChange={setBodyView}
            filter={filter}
            onFilterChange={setFilter}
          />
          <div className="flex-1 min-h-0">
            <BodyView view={bodyView} body={response.body} />
          </div>
        </>
      )}
      {activeTab === "headers" && <HeadersView headers={response.headers} />}
      {activeTab === "timing" && <Waterfall timing={response.timing} />}
    </aside>
  );
}

function LoadingView() {
  return (
    <aside className="flex flex-col h-full bg-card border-l border-border">
      <div className="flex flex-col items-center justify-center gap-3 flex-1 text-muted">
        <Loader2 size={28} className="animate-spin opacity-50" />
        <span className="text-[13px]" style={{ fontFamily: "var(--font-sans)" }}>
          Sending…
        </span>
      </div>
    </aside>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <aside className="flex flex-col h-full bg-card border-l border-border">
      <div className="flex flex-col items-center justify-center gap-3 flex-1 px-6 text-center">
        <CircleAlert size={28} className="text-status-5xx opacity-80" />
        <span className="text-[13px] text-status-5xx" style={{ fontFamily: "var(--font-mono)" }}>
          {message}
        </span>
      </div>
    </aside>
  );
}

function HeadersView({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  return (
    <div className="flex-1 min-h-0 overflow-auto p-3">
      {entries.length === 0 ? (
        <span className="text-[13px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>
          No headers.
        </span>
      ) : (
        <table className="w-full text-[12px]" style={{ fontFamily: "var(--font-mono)" }}>
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="border-b border-border/50">
                <td className="py-[6px] pr-4 text-muted whitespace-nowrap align-top">{k}</td>
                <td className="py-[6px] text-foreground break-all">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
