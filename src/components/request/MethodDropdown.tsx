// src/components/request/MethodDropdown.tsx
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { HTTP_METHODS, HttpMethod, METHOD_COLOR } from "../../lib/request-types";

interface MethodDropdownProps {
  method: HttpMethod;
  onChange: (method: HttpMethod) => void;
}

export function MethodDropdown({ method, onChange }: MethodDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        className="flex items-center gap-2 px-3 py-[9px] rounded-[6px] bg-card border border-border cursor-pointer hover:bg-secondary"
      >
        <span
          className={`text-[13px] font-bold tracking-[0.4px] ${METHOD_COLOR[method]}`}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {method}
        </span>
        {open ? (
          <ChevronUp size={14} className="text-muted" />
        ) : (
          <ChevronDown size={14} className="text-muted" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-[180px] rounded-[6px] bg-card border border-border shadow-lg">
          <ul className="flex flex-col gap-[1px] p-1">
            {HTTP_METHODS.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-[10px] py-[7px] rounded-[4px] cursor-pointer ${
                    m === method ? "bg-secondary" : "hover:bg-secondary"
                  }`}
                >
                  <span
                    className={`text-[12px] font-bold tracking-[0.4px] ${METHOD_COLOR[m]}`}
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {m}
                  </span>
                  {m === method && <Check size={12} className="text-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
