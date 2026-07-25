// src/components/request/UrlBar.tsx
import { CornerDownLeft, X } from "lucide-react";
import { MethodDropdown } from "./MethodDropdown";
import { useRequestStore } from "../../store/requestStore";
import { useResponseStore } from "../../store/responseStore";
import { useEnvStore } from "../../store/envStore";
import { hasPlaceholder, interpolatePreview } from "../../lib/interpolate";

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
  const activeEnv = useEnvStore((s) => s.environments.find((e) => e.id === s.activeId));

  if (!req) return null;

  // Preview only — Rust re-interpolates (authoritatively) at Send time.
  const urlPreview =
    activeEnv && hasPlaceholder(req.url)
      ? interpolatePreview(req.url, activeEnv.variables)
      : null;

  return (
    <div className="flex items-center gap-2 p-2 bg-card rounded-[8px] border border-border">
      <MethodDropdown method={req.method} onChange={(m) => setMethod(requestId, m)} />

      <div className="flex-1 min-w-0 flex flex-col">
        <input
          value={req.url}
          onChange={(e) => setUrl(requestId, e.target.value)}
          placeholder="https://api.example.com/resource"
          className="w-full px-3 py-[9px] text-[13px] bg-background border border-border rounded-[6px] text-foreground placeholder:text-muted outline-none focus:border-ring"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        {urlPreview !== null && urlPreview !== req.url && (
          <span
            className="px-3 pt-[3px] text-[11px] text-muted truncate"
            style={{ fontFamily: "var(--font-mono)" }}
            title={urlPreview}
          >
            {urlPreview}
          </span>
        )}
      </div>

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
