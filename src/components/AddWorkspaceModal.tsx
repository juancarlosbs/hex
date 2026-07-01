import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { useWorkspaceStore } from "../store/workspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddWorkspaceModal({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);

  if (!open) return null;

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    addWorkspace(trimmed, description.trim());
    setName("");
    setDescription("");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[440px] rounded-[6px] bg-card border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">New Workspace</span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={onClose} />
        </div>

        <div className="h-px bg-border" />

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">Workspace Name</label>
            <input
              autoFocus
              className="w-full rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none focus:border-ring"
              placeholder="e.g. API Workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
            />
          </div>

          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-semibold text-foreground">
              Description <span className="text-muted font-normal">Optional</span>
            </label>
            <textarea
              className="w-full rounded-[4px] bg-secondary border border-border px-3 py-2 text-[13px] text-foreground placeholder:text-muted outline-none resize-none focus:border-ring"
              placeholder="Describe this workspace…"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Footer */}
        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className={cn(
              "px-4 py-[7px] rounded-[4px] text-[13px] font-semibold cursor-pointer",
              name.trim()
                ? "bg-accent text-accent-foreground hover:bg-accent/90"
                : "bg-accent/40 text-accent-foreground/50 cursor-not-allowed"
            )}
            onClick={handleCreate}
            disabled={!name.trim()}
          >
            Create Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
