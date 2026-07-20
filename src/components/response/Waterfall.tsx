import { cn } from "../../lib/utils";
import { TimingBreakdown } from "../../lib/response-types";

interface WaterfallProps {
  timing: TimingBreakdown;
}

interface Phase {
  label: string;
  ms: number | null;
  barClass: string;
}

export function Waterfall({ timing }: WaterfallProps) {
  const phases: Phase[] = [
    { label: "DNS", ms: timing.dnsMs, barClass: "bg-timing-dns" },
    { label: "TCP", ms: timing.tcpMs, barClass: "bg-timing-tcp" },
    { label: "TLS", ms: timing.tlsMs, barClass: "bg-timing-tls" },
    { label: "TTFB", ms: timing.ttfbMs, barClass: "bg-timing-ttfb" },
    { label: "Download", ms: timing.downloadMs, barClass: "bg-timing-download" },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2">
      {phases
        .filter((phase): phase is Phase & { ms: number } => phase.ms !== null)
        .map((phase) => (
          <div key={phase.label} className="flex items-center gap-3">
            <span
              className="w-20 shrink-0 text-[11px] text-muted"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {phase.label}
            </span>
            <div className="flex-1 h-[6px] bg-secondary rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full", phase.barClass)}
                style={{ width: `${(phase.ms / timing.totalMs) * 100}%` }}
              />
            </div>
            <span
              className="w-14 shrink-0 text-right text-[12px] text-foreground"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {phase.ms}ms
            </span>
          </div>
        ))}
      <div
        className="pt-2 mt-1 border-t border-border text-[12px] text-foreground text-right"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Total: {timing.totalMs}ms
      </div>
    </div>
  );
}
