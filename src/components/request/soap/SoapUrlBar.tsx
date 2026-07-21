import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, CornerDownLeft, Hexagon, X } from "lucide-react";
import { useRequestStore } from "../../../store/requestStore";
import { useResponseStore } from "../../../store/responseStore";

interface SoapUrlBarProps {
  requestId: string;
}

const SOAP_VERSIONS = ["1.1", "1.2"];

export function SoapUrlBar({ requestId }: SoapUrlBarProps) {
  const req = useRequestStore((s) => s.openRequests[requestId]);
  const setSoapEndpoint = useRequestStore((s) => s.setSoapEndpoint);
  const setSoapVersion = useRequestStore((s) => s.setSoapVersion);
  const loading = useResponseStore((s) => s.responses[requestId]?.state === "loading");
  const send = useResponseStore((s) => s.send);
  const cancel = useResponseStore((s) => s.cancel);

  const [versionOpen, setVersionOpen] = useState(false);
  const versionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!versionOpen) return;
    const onDown = (e: PointerEvent) => {
      if (versionRef.current && !versionRef.current.contains(e.target as Node)) setVersionOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [versionOpen]);

  if (!req?.soap) return null;
  const { endpoint, soapVersion } = req.soap.meta;
  const schemaLoading = req.soap.schema === null;

  return (
    <div className="flex items-center gap-[10px] px-3 py-3 border-b border-border">
      <div ref={versionRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setVersionOpen((o) => !o)}
          className="flex items-center gap-[7px] px-[10px] py-[8px] rounded-[6px] border cursor-pointer"
          style={{
            background: "var(--color-soap-op-surface)",
            borderColor: "var(--color-soap-op)",
          }}
        >
          <Hexagon size={14} style={{ color: "var(--color-soap-op)" }} />
          <span
            className="text-[12px] font-semibold"
            style={{ color: "var(--color-soap-op)", fontFamily: "var(--font-sans)" }}
          >
            SOAP {soapVersion}
          </span>
          <ChevronDown size={13} style={{ color: "var(--color-soap-op)" }} />
        </button>

        {versionOpen && (
          <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-[140px] rounded-[6px] bg-card border border-border shadow-lg">
            <ul className="flex flex-col gap-[1px] p-1">
              {SOAP_VERSIONS.map((v) => (
                <li key={v}>
                  <button
                    type="button"
                    onClick={() => {
                      setSoapVersion(requestId, v);
                      setVersionOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-[10px] py-[7px] rounded-[4px] cursor-pointer ${
                      v === soapVersion ? "bg-secondary" : "hover:bg-secondary"
                    }`}
                  >
                    <span className="text-[12px] font-semibold text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
                      SOAP {v}
                    </span>
                    {v === soapVersion && <Check size={12} className="text-foreground" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <input
        value={endpoint}
        onChange={(e) => setSoapEndpoint(requestId, e.target.value)}
        placeholder="https://api.example.com/ws/Service"
        className="flex-1 min-w-0 px-[11px] py-[9px] text-[13px] bg-card border border-border rounded-[6px] text-foreground placeholder:text-muted outline-none focus:border-ring"
        style={{ fontFamily: "var(--font-mono)" }}
      />

      <button
        type="button"
        disabled={!loading && schemaLoading}
        onClick={() => (loading ? cancel(requestId) : send(req))}
        className="flex items-center justify-center gap-2 px-[18px] py-[9px] rounded-[6px] bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        style={{ fontFamily: "var(--font-sans)" }}
        title={loading ? "Cancel" : schemaLoading ? "Loading schema…" : "Send (⌘↵)"}
      >
        {loading ? "Cancel" : "Send"}
        {loading ? <X size={14} /> : <CornerDownLeft size={14} />}
      </button>
    </div>
  );
}
