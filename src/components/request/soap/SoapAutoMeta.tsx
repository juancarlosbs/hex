import { WandSparkles } from "lucide-react";
import { useRequestStore } from "../../../store/requestStore";

interface SoapAutoMetaProps {
  requestId: string;
}

function contentTypeFor(soapVersion: string): string {
  return soapVersion === "1.2" ? "application/soap+xml" : "text/xml";
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-[6px] min-w-0">
      <span className="text-[11px] text-muted shrink-0" style={{ fontFamily: "var(--font-sans)" }}>
        {label}
      </span>
      <span className="text-[11px] text-foreground truncate" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </span>
    </div>
  );
}

export function SoapAutoMeta({ requestId }: SoapAutoMetaProps) {
  const meta = useRequestStore((s) => s.openRequests[requestId]?.soap?.meta);
  if (!meta) return null;

  return (
    <div className="flex items-center gap-[10px] px-3 py-2 bg-card border-b border-border">
      <Meta label="SOAPAction" value={meta.soapAction || "—"} />
      <span className="w-px h-3 bg-border shrink-0" />
      <Meta label="Content-Type" value={contentTypeFor(meta.soapVersion)} />

      <span className="flex-1" />

      <span
        className="flex items-center gap-[5px] px-[7px] py-[3px] rounded-full shrink-0"
        style={{ background: "var(--color-soap-op-surface)" }}
      >
        <WandSparkles size={11} style={{ color: "var(--color-soap-op)" }} />
        <span
          className="text-[10px] font-semibold"
          style={{ color: "var(--color-soap-op)", fontFamily: "var(--font-sans)" }}
        >
          From binding
        </span>
      </span>
    </div>
  );
}
