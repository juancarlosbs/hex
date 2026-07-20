import { cn } from "../../../lib/utils";
import type { FormValue, SchemaNode } from "../../../lib/api";
import { defaultFormValue } from "../../../store/soapForm";
import { LeafField } from "./LeafField";

interface SchemaNodeFieldProps {
  node: SchemaNode;
  value: FormValue;
  onChange: (value: FormValue) => void;
  className?: string;
}

function isRepeatable(node: SchemaNode): boolean {
  const { max } = node.occurs;
  return max === "unbounded" || max.bounded > 1;
}

/** The default value for `node` when it's present, ignoring the node's own
 * optional/repeatable cardinality (those are handled by the caller). This
 * mirrors the tail of `defaultFormValue` (Task 8) — the kind-only default —
 * so toggling a node "on" (optional→present) or "off nil" restores the same
 * shape the store would have seeded had the node not been optional/nil. */
function presentDefault(node: SchemaNode): FormValue {
  if (node.kind === "any") return { raw: "" };
  if ("leaf" in node.kind) {
    const { default: def, fixed } = node.kind.leaf;
    return { leaf: fixed ?? def ?? "" };
  }
  if ("sequence" in node.kind) {
    return { sequence: node.kind.sequence.map(defaultFormValue) };
  }
  return { choice: { branch: 0, value: defaultFormValue(node.kind.choice[0]) } };
}

export function SchemaNodeField({ node, value, onChange, className }: SchemaNodeFieldProps) {
  if (node.occurs.min === 0) {
    return <OptionalField node={node} value={value} onChange={onChange} className={className} />;
  }
  return <PresentField node={node} value={value} onChange={onChange} className={className} />;
}

function OptionalField({ node, value, onChange, className }: SchemaNodeFieldProps) {
  const present = value !== "omitted";
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="flex items-center gap-2 text-[12px] text-foreground">
        <input
          aria-label={`${node.name} present`}
          type="checkbox"
          className="w-4 h-4 accent-primary"
          checked={present}
          onChange={(e) => onChange(e.target.checked ? presentDefault(node) : "omitted")}
        />
        {node.name}
      </label>
      {present && <PresentField node={node} value={value} onChange={onChange} />}
    </div>
  );
}

function PresentField({ node, value, onChange, className }: SchemaNodeFieldProps) {
  if (isRepeatable(node)) {
    return <RepeatableField node={node} value={value} onChange={onChange} className={className} />;
  }
  return <NillableOrKindField node={node} value={value} onChange={onChange} className={className} />;
}

function RepeatableField({ node, value, onChange, className }: SchemaNodeFieldProps) {
  const items = typeof value === "object" && value !== null && "repeated" in value ? value.repeated : [];
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-foreground">{node.name}</span>
        <button
          type="button"
          aria-label={`add ${node.name}`}
          className="text-[11px] text-muted hover:text-foreground"
          onClick={() => onChange({ repeated: [...items, presentDefault(node)] })}
        >
          + add
        </button>
      </div>
      <div className="flex flex-col gap-2 pl-3 border-l border-border">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <NillableOrKindField
              node={node}
              value={item}
              onChange={(v) => onChange({ repeated: items.map((it, j) => (j === i ? v : it)) })}
              className="flex-1"
            />
            <button
              type="button"
              aria-label={`remove ${node.name} ${i}`}
              className="text-[11px] text-muted hover:text-destructive"
              onClick={() => onChange({ repeated: items.filter((_, j) => j !== i) })}
            >
              remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NillableOrKindField({ node, value, onChange, className }: SchemaNodeFieldProps) {
  if (!node.nillable) {
    return <KindField node={node} value={value} onChange={onChange} className={className} />;
  }
  const isNil = value === "nil";
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="flex items-center gap-2 text-[11px] text-muted">
        <input
          aria-label={`${node.name} nil`}
          type="checkbox"
          className="w-4 h-4 accent-primary"
          checked={isNil}
          onChange={(e) => onChange(e.target.checked ? "nil" : presentDefault(node))}
        />
        nil
      </label>
      {!isNil && <KindField node={node} value={value} onChange={onChange} />}
    </div>
  );
}

function KindField({ node, value, onChange, className }: SchemaNodeFieldProps) {
  if (node.kind === "any") {
    const raw = typeof value === "object" && value !== null && "raw" in value ? value.raw : "";
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <textarea
          aria-label={node.name}
          className="px-2 py-[5px] text-[12px] rounded-[4px] border border-border bg-secondary text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          value={raw}
          onChange={(e) => onChange({ raw: e.target.value })}
        />
        <span className="text-[11px] text-muted">
          {node.doc ?? "recursive: expand on demand"}
        </span>
      </div>
    );
  }

  if ("leaf" in node.kind) {
    const leafValue = typeof value === "object" && value !== null && "leaf" in value ? value.leaf : null;
    return (
      <LeafField
        node={node}
        leaf={node.kind.leaf}
        value={leafValue}
        onChange={(v) => onChange({ leaf: v })}
        className={className}
      />
    );
  }

  if ("sequence" in node.kind) {
    const seqValues = typeof value === "object" && value !== null && "sequence" in value ? value.sequence : [];
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {node.kind.sequence.map((child, i) => (
          <SchemaNodeField
            key={i}
            node={child}
            value={seqValues[i]}
            onChange={(v) =>
              onChange({ sequence: seqValues.map((it, j) => (j === i ? v : it)) })
            }
          />
        ))}
      </div>
    );
  }

  // choice
  const branches = node.kind.choice;
  const choiceValue =
    typeof value === "object" && value !== null && "choice" in value
      ? value.choice
      : { branch: 0, value: defaultFormValue(branches[0]) };
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <select
        aria-label={`${node.name} branch`}
        className="px-2 py-[5px] text-[12px] rounded-[4px] border border-border bg-secondary text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        value={choiceValue.branch}
        onChange={(e) => {
          const branch = Number(e.target.value);
          onChange({ choice: { branch, value: defaultFormValue(branches[branch]) } });
        }}
      >
        {branches.map((b, i) => (
          <option key={i} value={i}>
            {b.name}
          </option>
        ))}
      </select>
      <SchemaNodeField
        node={branches[choiceValue.branch]}
        value={choiceValue.value}
        onChange={(v) => onChange({ choice: { branch: choiceValue.branch, value: v } })}
      />
    </div>
  );
}
