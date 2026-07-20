import { useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";

interface XmlTreeProps {
  xml: string;
}

export function XmlTree({ xml }: XmlTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror") || !doc.documentElement) {
    return (
      <pre
        className="w-full h-full overflow-auto bg-background text-foreground p-3 text-[12px] m-0"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {xml}
      </pre>
    );
  }

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  return (
    <div className="h-full overflow-auto p-2" style={{ fontFamily: "var(--font-mono)" }}>
      <XmlNode element={doc.documentElement} path="$" depth={0} collapsed={collapsed} onToggle={toggle} />
    </div>
  );
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.children);
}

function tagParts(tagName: string): { prefix: string; name: string } {
  const idx = tagName.indexOf(":");
  return idx === -1 ? { prefix: "", name: tagName } : { prefix: tagName.slice(0, idx + 1), name: tagName.slice(idx + 1) };
}

function TagLabel({ tagName }: { tagName: string }) {
  const { prefix, name } = tagParts(tagName);
  return (
    <span className="text-[12px] whitespace-nowrap shrink-0">
      {prefix && <span className="text-muted">{prefix}</span>}
      <span className="text-foreground">{name}</span>
      <span className="text-muted">:&nbsp;</span>
    </span>
  );
}

interface NodeProps {
  element: Element;
  path: string;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}

function XmlNode({ element, path, depth, collapsed, onToggle }: NodeProps) {
  const children = elementChildren(element);
  if (children.length === 0) {
    return <LeafNode element={element} depth={depth} />;
  }
  return <BranchNode element={element} children={children} path={path} depth={depth} collapsed={collapsed} onToggle={onToggle} />;
}

function BranchNode({
  element,
  children,
  path,
  depth,
  collapsed,
  onToggle,
}: NodeProps & { children: Element[] }) {
  const isCollapsed = collapsed.has(path);

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
        <TagLabel tagName={element.tagName} />
      </div>

      {!isCollapsed &&
        children.map((child, i) => (
          <XmlNode
            key={`${child.tagName}-${i}`}
            element={child}
            path={`${path}.${child.tagName}[${i}]`}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
}

function LeafNode({ element, depth }: { element: Element; depth: number }) {
  const value = element.textContent ?? "";
  const copy = () => navigator.clipboard.writeText(value);

  return (
    <div
      className="flex items-center gap-[6px] py-[3px] pr-[6px] rounded group hover:bg-secondary/50"
      style={{ paddingLeft: `${6 + depth * 16}px` }}
    >
      <span className="w-[13px] shrink-0" />
      <TagLabel tagName={element.tagName} />
      <span className="text-[12px] text-method-get truncate">{value}</span>
      <button
        type="button"
        aria-label="Copy value"
        onClick={copy}
        className="opacity-0 group-hover:opacity-40 hover:!opacity-100 cursor-pointer text-muted shrink-0 ml-auto bg-transparent border-0 p-0"
      >
        <Copy size={12} />
      </button>
    </div>
  );
}
