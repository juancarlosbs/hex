import { useEffect, useRef, useState } from "react";
import { Ban, Check, ChevronDown, Layers2, Plus, Settings2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const triggerVariants = cva(
  "flex items-center gap-[6px] rounded-[4px] border cursor-pointer transition-colors select-none px-[10px] py-[5px]",
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

const ENV_COLORS: Record<string, string> = {
  Development: "#28C840",
  Staging: "#FEBC2E",
  Production: "#FF5F57",
};

interface Env {
  name: string;
}

interface EnvSelectorProps extends VariantProps<typeof triggerVariants> {
  env: string | null;
  envs: Env[];
  onSelect: (env: string | null) => void;
  className?: string;
}

export function EnvSelector({ env, envs, onSelect, className }: EnvSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const dotColor = env ? (ENV_COLORS[env] ?? "#B8B9B6") : null;

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <div
        className={cn(triggerVariants({ state: open ? "open" : "idle" }), className)}
        onClick={() => setOpen((v) => !v)}
      >
        {dotColor ? (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
        ) : (
          <Layers2 size={13} className="text-foreground" />
        )}
        <span className="text-[12px] font-medium text-foreground">
          {env ?? "No Environment"}
        </span>
        <ChevronDown
          size={12}
          className={cn("text-muted transition-transform", open && "rotate-180")}
        />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full right-0 mt-1 w-[220px] rounded-md bg-[#1A1A1A] border border-[#2E2E2E] shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-[10px]">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-[0.5px]">
              Environments
            </span>
            <Plus size={14} className="text-muted cursor-pointer hover:text-foreground" />
          </div>

          {/* List */}
          <div className="flex flex-col gap-px px-[6px] pb-[6px]">
            {/* No Environment */}
            <div
              className={cn(
                "flex items-center gap-2 px-2 py-[7px] rounded-md cursor-pointer",
                env === null ? "bg-[#2a2a30]" : "hover:bg-[#2E2E2E]"
              )}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
            >
              <Ban size={13} className="text-muted" />
              <span className="text-[12px] text-muted">No Environment</span>
            </div>

            {envs.map(({ name }) => {
              const active = name === env;
              const color = ENV_COLORS[name] ?? "#B8B9B6";
              return (
                <div
                  key={name}
                  className={cn(
                    "flex items-center justify-between gap-2 px-2 py-[7px] rounded-md cursor-pointer",
                    active ? "bg-[#2a2a30]" : "hover:bg-[#2E2E2E]"
                  )}
                  onClick={() => {
                    onSelect(name);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className={cn(
                        "text-[12px]",
                        active ? "text-foreground font-semibold" : "text-muted font-normal"
                      )}
                    >
                      {name}
                    </span>
                  </div>
                  {active && <Check size={13} className="text-foreground shrink-0" />}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-[6px] px-3 py-2 border-t border-[#2E2E2E] cursor-pointer hover:bg-[#2E2E2E]">
            <Settings2 size={13} className="text-muted" />
            <span className="text-[12px] text-muted">Manage Environments</span>
          </div>
        </div>
      )}
    </div>
  );
}
