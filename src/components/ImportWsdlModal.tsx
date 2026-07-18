import { useState } from "react";
import { Hexagon, RefreshCw, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useWsdlImportStore } from "../store/wsdlImportStore";
import { useWorkspaceStore } from "../store/workspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportWsdlModal({ open, onClose }: Props) {
  const [url, setUrl] = useState("");
  const phase = useWsdlImportStore((s) => s.phase);
  const importWsdl = useWsdlImportStore((s) => s.importWsdl);
  const confirm = useWsdlImportStore((s) => s.confirm);
  const reset = useWsdlImportStore((s) => s.reset);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (!open) return null;

  const loading = phase.state === "loading";

  function close() {
    reset();
    setUrl("");
    onClose();
  }

  async function handlePrimary() {
    if (phase.state === "preview") {
      await confirm(workspaceId);
      setUrl("");
      onClose();
      return;
    }
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    importWsdl(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-[480px] rounded-[6px] bg-card border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">Import WSDL</span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={close} />
        </div>

        <div className="h-px bg-border" />

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">WSDL URL</label>
            <input
              autoFocus
              disabled={loading || phase.state === "preview"}
              className="w-full rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none focus:border-ring disabled:opacity-60"
              placeholder="https://example.com/service?wsdl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handlePrimary(); if (e.key === "Escape") close(); }}
            />
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <RefreshCw size={14} className="animate-spin" />
              Resolving schemas…
            </div>
          )}

          {phase.state === "error" && (
            <div className="rounded-[4px] border border-border bg-secondary px-3 py-2 text-[12px] text-destructive break-all">
              {phase.message}
            </div>
          )}

          {phase.state === "preview" && (
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-semibold text-foreground">
                {phase.preview.serviceName}
                <span className="text-muted font-normal">
                  {" "}· {phase.preview.operations.length} operations
                </span>
              </span>
              <div className="max-h-[240px] overflow-y-auto rounded-[4px] border border-border">
                {phase.preview.operations.map((op) => (
                  <div key={op.name} className="flex items-center gap-2 px-3 py-[6px] text-[13px] text-foreground">
                    <Hexagon size={14} className="text-soap-op shrink-0" />
                    {op.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Footer */}
        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={close}
          >
            Cancel
          </button>
          <button
            className={cn(
              "px-4 py-[7px] rounded-[4px] text-[13px] font-semibold cursor-pointer",
              (phase.state === "preview" || (url.trim() && !loading))
                ? "bg-accent text-accent-foreground hover:bg-accent/90"
                : "bg-accent/40 text-accent-foreground/50 cursor-not-allowed"
            )}
            onClick={handlePrimary}
            disabled={loading || (phase.state !== "preview" && !url.trim())}
          >
            {phase.state === "preview"
              ? `Import ${phase.preview.operations.length} Operations`
              : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
