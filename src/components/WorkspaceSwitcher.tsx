import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Layers, Plus, Search, Settings2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { useWorkspaceStore } from "../store/workspaceStore";

const triggerVariants = cva(
  "flex items-center justify-between gap-2 w-[162px] rounded-[4px] cursor-pointer shrink-0 border transition-colors select-none px-[10px] py-[6px]",
  {
    variants: {
      state: {
        idle: "bg-secondary border-border hover:bg-secondary/80",
        open: "bg-secondary border-border",
      },
    },
    defaultVariants: { state: "idle" },
  }
);

interface WorkspaceSwitcherProps extends VariantProps<typeof triggerVariants> {
  onAddWorkspace: () => void;
  onManageWorkspaces: () => void;
  className?: string;
}

export function WorkspaceSwitcher({ onAddWorkspace, onManageWorkspaces, className }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const { workspaces, activeId, setActive } = useWorkspaceStore();
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const filtered = workspaces.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className={cn(triggerVariants({ state: open ? "open" : "idle" }), className)}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={14} className="text-muted shrink-0" />
          <span className="text-[13px] font-medium text-foreground truncate">
            {active?.name ?? "No Workspace"}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={cn("text-muted shrink-0 transition-transform", open && "rotate-180")}
        />
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[220px] rounded-md bg-[#1A1A1A] border border-[#2E2E2E] shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-[10px]">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-[0.5px]">
              Workspaces
            </span>
            <Plus
              size={14}
              className="text-muted cursor-pointer hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onAddWorkspace(); }}
            />
          </div>

          <div className="px-3 pb-2">
            <div className="flex items-center gap-[6px] bg-[#2E2E2E] border border-[#2E2E2E] rounded-md px-2 py-[6px]">
              <Search size={12} className="text-muted shrink-0" />
              <input
                className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted outline-none"
                placeholder="Search workspaces…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-px px-[6px] pb-[6px]">
            {filtered.map((ws) => {
              const isActive = ws.id === activeId;
              return (
                <div
                  key={ws.id}
                  className={cn(
                    "flex items-center justify-between gap-2 px-2 py-[7px] rounded-md cursor-pointer",
                    isActive ? "bg-[#2a2a30]" : "hover:bg-[#2E2E2E]"
                  )}
                  onClick={() => { setActive(ws.id); setOpen(false); setSearch(""); }}
                >
                  <div className="flex items-center gap-2">
                    <Layers size={14} className={isActive ? "text-foreground" : "text-muted"} />
                    <span className={cn("text-[12px]", isActive ? "text-foreground font-semibold" : "text-muted font-normal")}>
                      {ws.name}
                    </span>
                  </div>
                  {isActive && <Check size={13} className="text-foreground shrink-0" />}
                </div>
              );
            })}
          </div>

          <div
            className="flex items-center gap-[6px] px-3 py-2 border-t border-[#2E2E2E] cursor-pointer hover:bg-[#2E2E2E]"
            onClick={() => { setOpen(false); onManageWorkspaces(); }}
          >
            <Settings2 size={13} className="text-muted" />
            <span className="text-[12px] text-muted">Manage Workspaces</span>
          </div>
        </div>
      )}
    </div>
  );
}
