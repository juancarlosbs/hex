import { cn } from "../../../lib/utils";
import type { SchemaNode, XsdType } from "../../../lib/api";

interface LeafFieldProps {
  node: SchemaNode;
  leaf: { xsdType: XsdType; enumValues: string[]; default: string | null; fixed: string | null };
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}

const inputClass =
  "px-2 py-[5px] text-[12px] rounded-[4px] border border-border bg-secondary text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

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

export function LeafField({ node, leaf, value, onChange, className }: LeafFieldProps) {
  const label = node.name;

  if (leaf.fixed !== null) {
    return (
      <input
        aria-label={label}
        readOnly
        className={cn(inputClass, className)}
        value={leaf.fixed}
      />
    );
  }

  if (leaf.enumValues.length > 0) {
    return (
      <select
        aria-label={label}
        className={cn(inputClass, className)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {leaf.enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }

  if (leaf.xsdType === "boolean") {
    return (
      <input
        aria-label={label}
        type="checkbox"
        className={cn("w-4 h-4 accent-primary", className)}
        checked={value === "true"}
        onChange={(e) => onChange(e.target.checked ? "true" : "false")}
      />
    );
  }

  return (
    <input
      aria-label={label}
      type={inputTypeFor(leaf.xsdType)}
      className={cn(inputClass, className)}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
