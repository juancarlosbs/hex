import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { api, type HistoryEntry } from "../../lib/api";
import { statusColorClass } from "../../lib/response-types";
import { formatBytes, formatMs } from "../response/ResponseStatusBar";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useResponseStore } from "../../store/responseStore";

interface HistoryTabProps {
  requestId: string;
}

export function HistoryTab({ requestId }: HistoryTabProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  // reload when the latest send settles (send() appends before storing the entry)
  const lastEntry = useResponseStore((s) => s.responses[requestId]);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let stale = false;
    api
      .listSendHistory(workspaceId, requestId)
      .then((list) => {
        if (!stale) setEntries(list);
      })
      .catch(() => {
        if (!stale) setEntries([]);
      });
    return () => {
      stale = true;
    };
  }, [workspaceId, requestId, lastEntry]);

  if (entries === null) return null;

  if (entries.length === 0) {
    return (
      <div className="p-4 text-[13px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>
        No sends yet. Hit Send and each attempt shows up here.
      </div>
    );
  }

  return (
    <div className="overflow-auto p-3">
      <table className="w-full text-[12px]" style={{ fontFamily: "var(--font-mono)" }}>
        <thead>
          <tr
            className="text-left text-[11px] text-muted"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <th className="py-[6px] pr-4 font-medium">Time</th>
            <th className="py-[6px] pr-4 font-medium">Status</th>
            <th className="py-[6px] pr-4 font-medium">Duration</th>
            <th className="py-[6px] font-medium">Size</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={`${e.timestampMs}-${i}`} className="border-b border-border/50">
              <td className="py-[6px] pr-4 text-muted whitespace-nowrap">
                {new Date(e.timestampMs).toLocaleString()}
              </td>
              <td
                className={cn(
                  "py-[6px] pr-4 font-semibold",
                  e.status === null ? "text-status-5xx" : statusColorClass(e.status),
                )}
                title={e.error ?? undefined}
              >
                {e.status ?? "Error"}
              </td>
              <td className="py-[6px] pr-4 text-foreground">{formatMs(e.timeMs)}</td>
              <td className="py-[6px] text-foreground">{formatBytes(e.sizeBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
