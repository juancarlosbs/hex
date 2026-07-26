// src/components/request/UrlBar.tsx
import { CornerDownLeft, History, X } from "lucide-react";
import { MethodDropdown } from "./MethodDropdown";
import { cn } from "../../lib/utils";
import { useRequestStore } from "../../store/requestStore";
import { useResponseStore } from "../../store/responseStore";
import { useHistoryStore } from "../../store/historyStore";

interface UrlBarProps {
  requestId: string;
}

export function UrlBar({ requestId }: UrlBarProps) {
  const req = useRequestStore((s) => s.openRequests[requestId]);
  const setUrl = useRequestStore((s) => s.setUrl);
  const setMethod = useRequestStore((s) => s.setMethod);
  const loading = useResponseStore((s) => s.responses[requestId]?.state === "loading");
  const send = useResponseStore((s) => s.send);
  const cancel = useResponseStore((s) => s.cancel);
  const toggle = useHistoryStore((s) => s.toggle);
  const drawerOpen = useHistoryStore((s) => s.openFor === requestId);

  if (!req) return null;

  return (
    <div className="flex items-center gap-2 p-2 bg-card rounded-[8px] border border-border">
      <MethodDropdown method={req.method} onChange={(m) => setMethod(requestId, m)} />

      <input
        value={req.url}
        onChange={(e) => setUrl(requestId, e.target.value)}
        placeholder="https://api.example.com/resource"
        className="flex-1 min-w-0 px-3 py-[9px] text-[13px] bg-background border border-border rounded-[6px] text-foreground placeholder:text-muted outline-none focus:border-ring"
        style={{ fontFamily: "var(--font-mono)" }}
      />

      {req.path.length > 0 && (
        <button
          type="button"
          onClick={() => toggle(requestId)}
          className={cn(
            "flex items-center justify-center px-3 py-[10px] rounded-[6px] border border-border cursor-pointer transition-colors",
            drawerOpen ? "bg-secondary text-foreground" : "bg-background text-muted hover:text-foreground",
          )}
          title="Send history"
        >
          <History size={15} />
        </button>
      )}

      <button
        type="button"
        onClick={() => (loading ? cancel(requestId) : send(req))}
        className="flex items-center gap-2 px-5 py-[10px] rounded-[6px] bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer hover:opacity-90"
        style={{ fontFamily: "var(--font-sans)" }}
        title={loading ? "Cancel" : "Send (⌘↵)"}
      >
        {loading ? "Cancel" : "Send"}
        {loading ? <X size={14} /> : <CornerDownLeft size={14} />}
      </button>
    </div>
  );
}
