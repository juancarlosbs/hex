// src/components/request/MethodBadge.tsx
import { HttpMethod, METHOD_COLOR } from "../../lib/request-types";
import { cn } from "../../lib/utils";

interface MethodBadgeProps {
  method: HttpMethod;
  className?: string;
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  return (
    <span
      className={cn(
        "text-[11px] font-bold tracking-[0.4px] uppercase",
        METHOD_COLOR[method],
        className,
      )}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {method}
    </span>
  );
}
