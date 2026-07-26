import { useEffect, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";
import type { HistoryEntry } from "../../lib/api";
import { useHistoryStore } from "../../store/historyStore";
import { useRequestStore } from "../../store/requestStore";

function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function HistoryDrawer() {
  const openFor = useHistoryStore((s) => s.openFor);
  const entries = useHistoryStore((s) => s.entries);
  const loading = useHistoryStore((s) => s.loading);
  const view = useHistoryStore((s) => s.view);
  const close = useHistoryStore((s) => s.close);
  const clear = useHistoryStore((s) => s.clear);
  const refresh = useHistoryStore((s) => s.refresh);
  const applyHistorySpec = useRequestStore((s) => s.applyHistorySpec);
  const dirty = useRequestStore((s) => (openFor ? s.openRequests[openFor]?.dirty : false));

  // Pending inline confirmation: an entry id awaiting a second click to restore,
  // "clear" awaiting a second click to clear history, or null.
  const [pending, setPending] = useState<number | "clear" | null>(null);

  useEffect(() => {
    setPending(null);
  }, [openFor]);

  if (!openFor) return null;

  const restore = async (entryId: number) => {
    let entry: HistoryEntry;
    try {
      entry = await api.getHistoryEntry(entryId);
    } catch {
      await refresh(openFor);
      return;
    }
    applyHistorySpec(openFor, entry.spec);
  };

  const handleRestoreClick = (entryId: number) => {
    if (dirty && pending !== entryId) {
      setPending(entryId);
      return;
    }
    setPending(null);
    void restore(entryId);
  };

  const handleClearClick = () => {
    if (pending !== "clear") {
      setPending("clear");
      return;
    }
    setPending(null);
    void clear(openFor);
  };

  return (
    <div className="absolute inset-y-0 right-0 w-[300px] z-10 flex flex-col bg-card border-l border-border shadow-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[12px] font-semibold text-foreground">History</span>
        <button type="button" onClick={close} className="text-muted hover:text-foreground cursor-pointer" title="Close">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && <div className="p-3 text-[12px] text-muted">Loading…</div>}
        {!loading && entries.length === 0 && (
          <div className="p-3 text-[12px] text-muted">No sends yet — hit Send and it will show up here.</div>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setPending(null);
              view(openFor, e.id);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                if (ev.key === " ") ev.preventDefault();
                setPending(null);
                view(openFor, e.id);
              }
            }}
            className="group flex items-center gap-2 px-3 py-2 border-b border-border/50 cursor-pointer hover:bg-secondary/60"
          >
            <span
              className={cn(
                "text-[11px] font-semibold px-[6px] py-[1px] rounded-[4px]",
                e.error != null || (e.status ?? 0) >= 400
                  ? "bg-destructive/15 text-destructive"
                  : "bg-primary/15 text-primary",
              )}
            >
              {e.error != null ? "Error" : e.status}
            </span>
            <span className="text-[12px] text-foreground">{e.method}</span>
            <span className="flex-1 text-right text-[11px] text-muted">
              {e.durationMs != null ? `${e.durationMs}ms · ` : ""}
              {relativeTime(e.executedAtMs)}
            </span>
            {pending === e.id ? (
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleRestoreClick(e.id);
                }}
                className="text-[10px] font-medium text-destructive hover:underline cursor-pointer"
              >
                Overwrite?
              </button>
            ) : (
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleRestoreClick(e.id);
                }}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted hover:text-foreground cursor-pointer"
                title="Restore this request into the editor"
              >
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {entries.length > 0 && (
        <button
          type="button"
          onClick={handleClearClick}
          className={cn(
            "flex items-center gap-2 px-3 py-2 text-[12px] border-t border-border cursor-pointer",
            pending === "clear" ? "text-destructive" : "text-muted hover:text-destructive",
          )}
        >
          <Trash2 size={13} /> {pending === "clear" ? "Really clear?" : "Clear history"}
        </button>
      )}
    </div>
  );
}
