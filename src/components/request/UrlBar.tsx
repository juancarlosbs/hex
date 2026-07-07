// src/components/request/UrlBar.tsx
import { CornerDownLeft } from "lucide-react";
import { MethodDropdown } from "./MethodDropdown";
import { useRequestStore } from "../../store/requestStore";

interface UrlBarProps {
  requestId: string;
}

export function UrlBar({ requestId }: UrlBarProps) {
  const req = useRequestStore((s) => s.openRequests[requestId]);
  const setUrl = useRequestStore((s) => s.setUrl);
  const setMethod = useRequestStore((s) => s.setMethod);

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

      <button
        type="button"
        className="flex items-center gap-2 px-5 py-[10px] rounded-[6px] bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer hover:opacity-90"
        style={{ fontFamily: "var(--font-sans)" }}
        title="Send (⌘↵)"
      >
        Send
        <CornerDownLeft size={14} />
      </button>
    </div>
  );
}
