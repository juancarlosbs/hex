import { Hexagon, RefreshCw, X } from "lucide-react";
import { useUpdateDefinitionStore } from "../store/updateDefinitionStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { DefinitionUpdatePreview } from "../lib/api";

function Section({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
        {title}
      </span>
      <div className="max-h-[120px] overflow-y-auto rounded-[4px] border border-border">
        {names.map((name) => (
          <div key={name} className="flex items-center gap-2 px-3 py-[6px] text-[13px] text-foreground">
            <Hexagon size={14} className="text-soap-op shrink-0" />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

const isEmpty = (d: DefinitionUpdatePreview["diff"]) =>
  d.new.length === 0 && d.changed.length === 0 && d.removed.length === 0;

export function UpdateDefinitionModal() {
  const phase = useUpdateDefinitionStore((s) => s.phase);
  const apply = useUpdateDefinitionStore((s) => s.apply);
  const reset = useUpdateDefinitionStore((s) => s.reset);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (phase.state === "idle") return null;

  const upToDate = phase.state === "preview" && isEmpty(phase.preview.diff);
  const applicable = phase.state === "preview" && !upToDate;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) reset(); }}
    >
      <div className="w-[480px] rounded-[6px] bg-card border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">Update Definition</span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={reset} />
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-4 px-5 py-5">
          {phase.state === "loading" && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <RefreshCw size={14} className="animate-spin" />
              Fetching WSDL…
            </div>
          )}

          {phase.state === "error" && (
            <div className="rounded-[4px] border border-border bg-secondary px-3 py-2 text-[12px] text-destructive break-all">
              {phase.message}
            </div>
          )}

          {phase.state === "done" && (
            <span className="text-[13px] text-foreground">{phase.summary}</span>
          )}

          {upToDate && (
            <span className="text-[13px] text-muted">
              Everything is up to date — the WSDL matches the imported operations.
            </span>
          )}

          {applicable && phase.state === "preview" && (
            <>
              <span className="text-[12px] font-semibold text-foreground">
                {phase.preview.serviceName}
                <span className="text-muted font-normal"> · {phase.preview.wsdlUrl}</span>
              </span>
              <Section title="New" names={phase.preview.diff.new.map((o) => o.name)} />
              <Section title="Changed" names={phase.preview.diff.changed.map((o) => o.name)} />
              <Section title="Removed → Orphans" names={phase.preview.diff.removed} />
            </>
          )}
        </div>

        <div className="h-px bg-border" />

        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          {applicable ? (
            <>
              <button
                className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
                onClick={reset}
              >
                Cancel
              </button>
              <button
                className="px-4 py-[7px] rounded-[4px] text-[13px] font-semibold bg-accent text-accent-foreground hover:bg-accent/90 cursor-pointer"
                onClick={() => apply(workspaceId)}
              >
                Apply Changes
              </button>
            </>
          ) : (
            <button
              className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
              onClick={reset}
            >
              {phase.state === "loading" ? "Cancel" : "OK"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
