import { ChevronDown } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { SchemaNode, XsdType } from "../../../lib/api";

interface LeafFieldProps {
  node: SchemaNode;
  leaf: { xsdType: XsdType; enumValues: string[]; default: string | null; fixed: string | null };
  value: string | null;
  onChange: (value: string | null) => void;
}

const inputClass =
  "w-full px-[10px] py-[7px] text-[13px] rounded-[6px] border border-border bg-card text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

function inputTypeFor(xsdType: XsdType): string {
  switch (xsdType) {
    case "date":
      return "date";
    case "dateTime":
      return "datetime-local";
    case "time":
      return "time";
    case "integer":
    case "decimal":
    case "double":
      return "number";
    default:
      return "text";
  }
}

export function LeafField({ node, leaf, value, onChange }: LeafFieldProps) {
  const label = node.name;

  if (leaf.fixed !== null) {
    return <input aria-label={label} readOnly className={inputClass} value={leaf.fixed} />;
  }

  if (leaf.enumValues.length > 0) {
    return (
      <div className="relative w-full">
        <select
          aria-label={label}
          className={cn(inputClass, "appearance-none pr-8 cursor-pointer")}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {leaf.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-[10px] top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
      </div>
    );
  }

  if (leaf.xsdType === "boolean") {
    const on = value === "true";
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(on ? "false" : "true")}
        className="relative w-[38px] h-[22px] rounded-full transition-colors shrink-0 cursor-pointer"
        style={{ background: on ? "var(--color-primary)" : "var(--color-secondary)" }}
      >
        <span
          className="absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white transition-all"
          style={{ left: on ? "19px" : "3px" }}
        />
      </button>
    );
  }

  return (
    <input
      aria-label={label}
      type={inputTypeFor(leaf.xsdType)}
      className={inputClass}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
