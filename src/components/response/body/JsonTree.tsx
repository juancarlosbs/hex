import { useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { cn } from "../../../lib/utils";

type JsonVal = string | number | boolean | null | JsonVal[] | { [k: string]: JsonVal };

interface JsonTreeProps {
  value: unknown;
}

export function JsonTree({ value }: JsonTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  return (
    <div className="h-full overflow-auto p-2" style={{ fontFamily: "var(--font-mono)" }}>
      <JsonNode value={value as JsonVal} path="$" depth={0} collapsed={collapsed} onToggle={toggle} />
    </div>
  );
}

interface NodeProps {
  value: JsonVal;
  path: string;
  keyLabel?: string;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}

function JsonNode(props: NodeProps) {
  const { value } = props;
  if (value !== null && typeof value === "object") {
    return <BranchNode {...props} />;
  }
  return <LeafNode value={value as string | number | boolean | null} keyLabel={props.keyLabel} depth={props.depth} />;
}

function BranchNode({ value, path, keyLabel, depth, collapsed, onToggle }: NodeProps) {
  const isCollapsed = collapsed.has(path);
  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as JsonVal[]).map((v, i) => [`${i}`, v] as [string, JsonVal])
    : Object.entries(value as { [k: string]: JsonVal });
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";

  return (
    <div>
      <div
        className="flex items-center gap-[2px] py-[3px] pr-[6px] rounded cursor-pointer hover:bg-secondary/50 select-none"
        style={{ paddingLeft: `${6 + depth * 16}px` }}
        onClick={() => onToggle(path)}
      >
        {isCollapsed ? (
          <ChevronRight size={13} className="text-muted shrink-0" />
        ) : (
          <ChevronDown size={13} className="text-muted shrink-0" />
        )}
        {keyLabel !== undefined && (
          <span className="text-muted text-[12px] whitespace-nowrap">&quot;{keyLabel}&quot;:&nbsp;</span>
        )}
        <span className="text-foreground text-[12px]">
          {isCollapsed ? `${open} … ${close}` : open}
        </span>
      </div>

      {!isCollapsed && (
        <>
          {entries.map(([k, v]) => (
            <JsonNode
              key={k}
              value={v}
              path={`${path}.${k}`}
              keyLabel={isArray ? undefined : k}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
          <div
            className="py-[3px] pr-[6px] text-foreground text-[12px]"
            style={{ paddingLeft: `${6 + depth * 16 + 15}px` }}
          >
            {close}
          </div>
        </>
      )}
    </div>
  );
}

function LeafNode({
  value,
  keyLabel,
  depth,
}: {
  value: string | number | boolean | null;
  keyLabel?: string;
  depth: number;
}) {
  const raw = value === null ? "null" : String(value);
  const copy = () => navigator.clipboard.writeText(raw);

  return (
    <div
      className="flex items-center gap-[6px] py-[3px] pr-[6px] rounded group hover:bg-secondary/50"
      style={{ paddingLeft: `${6 + depth * 16}px` }}
    >
      <span className="w-[13px] shrink-0" />
      {keyLabel !== undefined && (
        <span className="text-muted text-[12px] whitespace-nowrap shrink-0">&quot;{keyLabel}&quot;:&nbsp;</span>
      )}
      <span className={cn("text-[12px] truncate", leafColorClass(value))}>{formatLeaf(value)}</span>
      <Copy
        size={12}
        onClick={copy}
        className="opacity-0 group-hover:opacity-40 hover:!opacity-100 cursor-pointer text-muted shrink-0 ml-auto"
      />
    </div>
  );
}

function leafColorClass(value: string | number | boolean | null): string {
  if (typeof value === "string") return "text-method-get";
  if (typeof value === "boolean") return "text-method-put";
  if (typeof value === "number") return "text-soap-op";
  return "text-muted";
}

function formatLeaf(value: string | number | boolean | null): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  return String(value);
}
