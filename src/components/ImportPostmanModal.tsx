import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { FileJson, RefreshCw, X } from "lucide-react";
import { cn } from "../lib/utils";
import { usePostmanImportStore } from "../store/postmanImportStore";
import { useWorkspaceStore } from "../store/workspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportPostmanModal({ open: isOpen, onClose }: Props) {
  const [collectionPath, setCollectionPath] = useState<string | null>(null);
  const [environmentPath, setEnvironmentPath] = useState<string | null>(null);
  const phase = usePostmanImportStore((s) => s.phase);
  const importCollection = usePostmanImportStore((s) => s.importCollection);
  const confirm = usePostmanImportStore((s) => s.confirm);
  const reset = usePostmanImportStore((s) => s.reset);
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (!isOpen) return null;

  const loading = phase.state === "loading";

  function close() {
    reset();
    setCollectionPath(null);
    setEnvironmentPath(null);
    onClose();
  }

  async function pickCollection() {
    const path = await open({ filters: [{ name: "Postman Collection", extensions: ["json"] }] });
    if (typeof path === "string") setCollectionPath(path);
  }

  async function pickEnvironment() {
    const path = await open({ filters: [{ name: "Postman Environment", extensions: ["json"] }] });
    if (typeof path === "string") setEnvironmentPath(path);
  }

  async function handlePrimary() {
    if (phase.state === "preview") {
      await confirm(workspaceId);
      if (usePostmanImportStore.getState().phase.state !== "error") {
        setCollectionPath(null);
        setEnvironmentPath(null);
        onClose();
      }
      return;
    }
    if (!collectionPath || loading) return;
    const collectionJson = await readTextFile(collectionPath);
    const environmentJson = environmentPath ? await readTextFile(environmentPath) : null;
    importCollection(collectionJson, environmentJson);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-[480px] rounded-[6px] bg-card border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">Import Postman Collection</span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={close} />
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">Collection file</label>
            <button
              type="button"
              disabled={loading || phase.state === "preview"}
              className="w-full flex items-center justify-between rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground disabled:opacity-60 cursor-pointer"
              onClick={pickCollection}
            >
              <span className={collectionPath ? "text-foreground" : "text-muted"}>
                {collectionPath ?? "Choose a Postman collection .json…"}
              </span>
            </button>
          </div>

          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">Environment file (optional)</label>
            <button
              type="button"
              disabled={loading || phase.state === "preview"}
              className="w-full flex items-center justify-between rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground disabled:opacity-60 cursor-pointer"
              onClick={pickEnvironment}
            >
              <span className={environmentPath ? "text-foreground" : "text-muted"}>
                {environmentPath ?? "Choose a Postman environment .json…"}
              </span>
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <RefreshCw size={14} className="animate-spin" />
              Parsing collection…
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
                {phase.preview.collectionName}
                <span className="text-muted font-normal">
                  {" "}· {phase.preview.requests.length} requests
                  {phase.preview.environment ? " · environment imported" : ""}
                </span>
              </span>
              {phase.preview.summary.skipped.length > 0 && (
                <div className="max-h-[160px] overflow-y-auto rounded-[4px] border border-border">
                  {phase.preview.summary.skipped.map((line, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-[6px] text-[12px] text-muted">
                      <FileJson size={13} className="text-muted shrink-0" />
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

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
              (phase.state === "preview" || (collectionPath && !loading))
                ? "bg-accent text-accent-foreground hover:bg-accent/90"
                : "bg-accent/40 text-accent-foreground/50 cursor-not-allowed"
            )}
            onClick={handlePrimary}
            disabled={loading || (phase.state !== "preview" && !collectionPath)}
          >
            {phase.state === "preview"
              ? `Import ${phase.preview.requests.length} Requests`
              : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
