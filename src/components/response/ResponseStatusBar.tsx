import { Download } from "lucide-react";
import { cn } from "../../lib/utils";
import { HttpResponse, statusBgClass, statusColorClass } from "../../lib/response-types";

interface ResponseStatusBarProps {
  response: HttpResponse;
}

export function ResponseStatusBar({ response }: ResponseStatusBarProps) {
  const { status, statusText, timeMs, sizeBytes } = response;
  return (
    <div className="flex items-center gap-4 px-[14px] py-[10px] border-b border-border shrink-0">
      <div className="flex items-center gap-[7px]">
        <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", statusBgClass(status))} />
        <span
          className={cn("text-[13px] font-bold", statusColorClass(status))}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {status} {statusText}
        </span>
      </div>
      <MetaPair label="Time" value={formatMs(timeMs)} />
      <MetaPair label="Size" value={formatBytes(sizeBytes)} />
      <div className="flex-1" />
      <Download size={14} className="text-muted cursor-pointer hover:text-foreground" />
    </div>
  );
}

function MetaPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-[5px]">
      <span className="text-[11px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>
        {label}
      </span>
      <span className="text-[12px] font-semibold text-foreground" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </span>
    </div>
  );
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
