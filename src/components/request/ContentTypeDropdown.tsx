import { useEffect, useRef, useState } from "react";
import { Braces, Check, ChevronDown, ChevronUp, Code, Paperclip, LucideIcon } from "lucide-react";
import { BodyMode } from "../../lib/request-types";

interface ContentTypeOption {
  mode: BodyMode;
  icon: LucideIcon;
  label: string;
}

const OPTIONS: ContentTypeOption[] = [
  { mode: "json", icon: Code, label: "application/json" },
  { mode: "form-urlencoded", icon: Braces, label: "application/x-www-form-urlencoded" },
  { mode: "form-multipart", icon: Paperclip, label: "multipart/form-data" },
];

interface ContentTypeDropdownProps {
  mode: BodyMode;
  onChange: (mode: BodyMode) => void;
}

export function ContentTypeDropdown({ mode, onChange }: ContentTypeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0];
  const CurrentIcon = current.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-[10px] py-[7px] rounded-[6px] bg-card border border-border cursor-pointer hover:bg-secondary"
      >
        <CurrentIcon size={13} className="text-muted" />
        <span
          className="text-[12px] text-foreground"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {current.label}
        </span>
        {open ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
      </button>

      {open && (
        <ul className="absolute left-0 top-[calc(100%+4px)] z-30 w-[296px] rounded-[6px] bg-card border border-border shadow-lg p-1">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = o.mode === mode;
            return (
              <li key={o.mode}>
                <button
                  type="button"
                  onClick={() => { onChange(o.mode); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-[10px] py-[7px] rounded-[4px] cursor-pointer ${
                    active ? "bg-secondary" : "hover:bg-secondary"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={13} className="text-muted" />
                    <span className="text-[12px] text-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                      {o.label}
                    </span>
                  </span>
                  {active && <Check size={12} className="text-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
