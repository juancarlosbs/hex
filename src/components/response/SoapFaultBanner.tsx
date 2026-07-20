import { CircleAlert } from "lucide-react";
import { SoapFault } from "../../lib/response-types";

interface SoapFaultBannerProps {
  fault: SoapFault;
}

/** SOAP Fault renders as a structured error, never the green/success status bar (product rule F3). */
export function SoapFaultBanner({ fault }: SoapFaultBannerProps) {
  return (
    <div className="flex flex-col gap-[6px] px-[14px] py-[10px] border-b border-border bg-status-5xx/10 shrink-0">
      <div className="flex items-center gap-[7px]">
        <CircleAlert size={14} className="text-status-5xx shrink-0" />
        <span
          className="text-[13px] font-bold text-status-5xx"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          soap:Fault — {fault.code}
        </span>
      </div>
      <span className="text-[12px] text-foreground" style={{ fontFamily: "var(--font-sans)" }}>
        {fault.reason}
      </span>
      {fault.detail && (
        <span
          className="text-[11px] text-muted whitespace-pre-wrap"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {fault.detail}
        </span>
      )}
    </div>
  );
}
