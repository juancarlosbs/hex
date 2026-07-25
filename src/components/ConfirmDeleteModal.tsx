import { X } from "lucide-react";

interface Props {
  open: boolean;
  name: string;
  /** Folders warn that everything inside is deleted too. */
  isFolder: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// Anti-SoapUI: never lose a request — every deletion goes through this modal.
export function ConfirmDeleteModal({ open, name, isFolder, onConfirm, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 cursor-default"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="w-[400px] rounded-[6px] bg-card border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] font-semibold text-foreground">
            Delete {isFolder ? "folder" : "request"}
          </span>
          <X size={16} className="text-muted cursor-pointer hover:text-foreground" onClick={onClose} />
        </div>

        <div className="h-px bg-border" />

        {/* Body */}
        <div className="px-5 py-5 text-[13px] text-foreground">
          Delete <span className="font-semibold">{name}</span>?{" "}
          {isFolder && "Every request inside it will be deleted too. "}
          This cannot be undone.
        </div>

        <div className="h-px bg-border" />

        {/* Footer */}
        <div className="flex items-center justify-end gap-[10px] px-5 py-[14px]">
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-medium text-foreground bg-secondary border border-border hover:bg-secondary/80 cursor-pointer"
            onClick={onClose}
            autoFocus
          >
            Cancel
          </button>
          <button
            className="px-4 py-[7px] rounded-[4px] text-[13px] font-semibold bg-destructive text-foreground hover:bg-destructive/90 cursor-pointer"
            onClick={() => { onConfirm(); onClose(); }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
