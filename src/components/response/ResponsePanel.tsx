import { useState } from "react";
import { HttpResponse, ResponseBodyView, ResponseTab } from "../../lib/response-types";
import { ResponsePlaceholder } from "./ResponsePlaceholder";
import { ResponseStatusBar } from "./ResponseStatusBar";
import { ResponseTabsStrip } from "./ResponseTabsStrip";
import { ResponseFilterBar } from "./ResponseFilterBar";
import { ResponseBodyView as BodyView } from "./body/ResponseBodyView";

// ponytail: static fixture — replace with useResponseStore when wiring Tauri command
const STATIC_FIXTURE: HttpResponse = {
  status: 200,
  statusText: "OK",
  timeMs: 142,
  sizeBytes: 2150,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": "req_31c9",
  },
  body: JSON.stringify(
    {
      data: {
        user: { id: "usr_8f2a", email: "ada@acme.dev", role: "admin", active: true },
        teams: ["core", "billing"],
      },
      meta: { requestId: "req_31c9", durationMs: 142 },
    },
    null,
    2,
  ),
};

export function ResponsePanel() {
  // ponytail: swap useState(STATIC_FIXTURE) for useResponseStore(s => s.response) when ready
  const [response] = useState<HttpResponse | null>(STATIC_FIXTURE);
  const [activeTab, setActiveTab] = useState<ResponseTab>("body");
  const [bodyView, setBodyView] = useState<ResponseBodyView>("tree");
  const [filter, setFilter] = useState("");

  if (!response) return <ResponsePlaceholder />;

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
      {activeTab === "timing" && <TimingStub />}
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

function TimingStub() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted text-[13px]" style={{ fontFamily: "var(--font-sans)" }}>
      Timing waterfall — coming soon.
    </div>
  );
}
