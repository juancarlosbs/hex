import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { FormValue, SchemaNode } from "../../../lib/api";
import { defaultFormValue } from "../../../store/soapForm";
import { LeafField } from "./LeafField";

interface SchemaNodeFieldProps {
  node: SchemaNode;
  value: FormValue;
  onChange: (value: FormValue) => void;
  depth?: number;
  /** The root node's own sequence header is not shown — its children are the
   * top-level rows (mirrors the Pencil design). */
  root?: boolean;
}

/** Expand/collapse control for a complex row's chevron. */
interface Toggle {
  open: boolean;
  onToggle: () => void;
}

type RowProps = SchemaNodeFieldProps & {
  depth: number;
  lead?: ReactNode;
  optional?: boolean;
  trailing?: ReactNode;
};

const INDENT = 20;
const padLeft = (depth: number) => 12 + depth * INDENT;

function isRepeatable(node: SchemaNode): boolean {
  const { max } = node.occurs;
  return max === "unbounded" || max.bounded > 1;
}

function isSequence(node: SchemaNode): node is SchemaNode & { kind: { sequence: SchemaNode[] } } {
  return node.kind !== "any" && "sequence" in node.kind;
}

function isChoice(node: SchemaNode): boolean {
  return node.kind !== "any" && "choice" in node.kind;
}

function isPlainSequence(node: SchemaNode): boolean {
  return node.occurs.min >= 1 && !isRepeatable(node) && !node.nillable && isSequence(node);
}

/** The default value for `node` when it's present, ignoring the node's own
 * optional/repeatable cardinality (those are handled by the caller). */
function presentDefault(node: SchemaNode): FormValue {
  if (isRepeatable(node)) return { repeated: [] };
  return kindDefault(node);
}

/** The default value for one instance of `node`'s kind, ignoring BOTH its
 * optional and repeatable cardinality — used to seed a single repeated item. */
function kindDefault(node: SchemaNode): FormValue {
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

function hasChevron(node: SchemaNode): boolean {
  return isRepeatable(node) || isSequence(node) || isChoice(node);
}

function typeText(node: SchemaNode): string {
  if (isRepeatable(node)) {
    const { max } = node.occurs;
    return `maxOccurs=${max === "unbounded" ? "unbounded" : max.bounded}`;
  }
  if (node.kind === "any") return "xs:any";
  if ("leaf" in node.kind) {
    return node.kind.leaf.enumValues.length > 0 ? "xs:enumeration" : `xs:${node.kind.leaf.xsdType}`;
  }
  if ("choice" in node.kind) return "xs:choice";
  return "complex";
}

function typeColor(node: SchemaNode): string {
  return !isRepeatable(node) && isChoice(node) ? "var(--color-soap-op)" : "var(--color-muted)";
}

function Spacer() {
  return <span className="w-[14px] shrink-0" aria-hidden />;
}

function RowShell({ depth, fill, children }: { depth: number; fill?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 pr-3 py-[9px] border-b border-border",
        fill && "bg-card",
      )}
      style={{ paddingLeft: padLeft(depth) }}
    >
      {children}
    </div>
  );
}

function FieldLeft({
  node,
  lead,
  toggle,
  optional,
}: {
  node: SchemaNode;
  lead?: ReactNode;
  toggle?: Toggle;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-[7px] min-w-0">
      {lead}
      {toggle ? (
        <button
          type="button"
          aria-label={`toggle ${node.name}`}
          onClick={toggle.onToggle}
          className="flex items-center shrink-0 text-muted cursor-pointer"
        >
          {toggle.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : lead ? null : (
        <Spacer />
      )}
      <span
        className={cn("text-[13px] font-mono truncate", hasChevron(node) ? "font-semibold" : "font-medium")}
        style={{ color: optional ? "var(--color-muted)" : "var(--color-foreground)" }}
      >
        {node.name}
      </span>
      {node.occurs.min >= 1 && !optional && (
        <span className="text-[13px] font-mono font-bold text-destructive shrink-0">*</span>
      )}
      <span className="text-[11px] font-mono shrink-0" style={{ color: typeColor(node) }}>
        {typeText(node)}
      </span>
      {optional && (
        <span className="flex items-center px-[6px] py-[2px] rounded-full border border-muted text-[10px] leading-none text-muted shrink-0">
          optional
        </span>
      )}
    </div>
  );
}

function RightCell({ control, trailing }: { control?: ReactNode; trailing?: ReactNode }) {
  if (!control && !trailing) return null;
  return (
    <div className="w-[300px] shrink-0 flex items-center gap-2">
      <div className="flex-1 flex justify-end">{control}</div>
      {trailing}
    </div>
  );
}

/** Renders the sequence children as flattened rows (no header for the sequence
 * itself). Shared by the root and by nested sequence/choice-branch headers. */
function SequenceChildren({ node, value, onChange, depth }: SchemaNodeFieldProps & { depth: number }) {
  const children = isSequence(node) ? node.kind.sequence : [];
  const values =
    typeof value === "object" && value !== null && "sequence" in value ? value.sequence : [];
  return (
    <>
      {children.map((child, i) => (
        <SchemaNodeField
          key={i}
          node={child}
          value={values[i]}
          depth={depth}
          onChange={(v) => onChange({ sequence: values.map((it, j) => (j === i ? v : it)) })}
        />
      ))}
    </>
  );
}

function ChoiceSegments({
  node,
  branch,
  onChange,
}: {
  node: SchemaNode;
  branch: number;
  onChange: (value: FormValue) => void;
}) {
  const branches = node.kind !== "any" && "choice" in node.kind ? node.kind.choice : [];
  return (
    <div className="flex items-center rounded-[6px] border border-border bg-secondary p-[2px]">
      {branches.map((b, i) => {
        const active = i === branch;
        return (
          <button
            key={i}
            type="button"
            aria-label={`${node.name} branch ${b.name}`}
            onClick={() => onChange({ choice: { branch: i, value: defaultFormValue(branches[i]) } })}
            className={cn(
              "px-[14px] py-[6px] text-[12px] font-mono rounded-[4px] cursor-pointer",
              active ? "text-white" : "text-muted",
            )}
            style={active ? { background: "var(--color-soap-op)" } : undefined}
          >
            {b.name}
          </button>
        );
      })}
    </div>
  );
}

function AnyRow({ node, value, onChange, depth, lead, optional, trailing }: RowProps) {
  const raw = typeof value === "object" && value !== null && "raw" in value ? value.raw : "";
  return (
    <RowShell depth={depth}>
      <FieldLeft node={node} lead={lead} optional={optional} />
      <RightCell
        control={
          <textarea
            aria-label={node.name}
            className="w-full px-[10px] py-[7px] text-[12px] rounded-[6px] border border-border bg-card text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            value={raw}
            onChange={(e) => onChange({ raw: e.target.value })}
          />
        }
        trailing={trailing}
      />
    </RowShell>
  );
}

function LeafRow({ node, value, onChange, depth, lead, optional, trailing }: RowProps) {
  const leaf = node.kind !== "any" && "leaf" in node.kind ? node.kind.leaf : null;
  const leafValue = typeof value === "object" && value !== null && "leaf" in value ? value.leaf : null;
  return (
    <RowShell depth={depth}>
      <FieldLeft node={node} lead={lead} optional={optional} />
      <RightCell
        control={
          leaf && (
            <LeafField node={node} leaf={leaf} value={leafValue} onChange={(v) => onChange({ leaf: v })} />
          )
        }
        trailing={trailing}
      />
    </RowShell>
  );
}

function SequenceRows({ node, value, onChange, depth, lead, optional, trailing }: RowProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <RowShell depth={depth} fill>
        <FieldLeft
          node={node}
          lead={lead}
          optional={optional}
          toggle={{ open, onToggle: () => setOpen((o) => !o) }}
        />
        <RightCell trailing={trailing} />
      </RowShell>
      {open && <SequenceChildren node={node} value={value} onChange={onChange} depth={depth + 1} />}
    </>
  );
}

function ChoiceRows({ node, value, onChange, depth, lead, optional, trailing }: RowProps) {
  const [open, setOpen] = useState(true);
  const branches = node.kind !== "any" && "choice" in node.kind ? node.kind.choice : [];
  const choiceValue =
    typeof value === "object" && value !== null && "choice" in value
      ? value.choice
      : { branch: 0, value: defaultFormValue(branches[0]) };
  const selected = branches[choiceValue.branch];
  const onBranchChange = (v: FormValue) =>
    onChange({ choice: { branch: choiceValue.branch, value: v } });
  return (
    <>
      <RowShell depth={depth} fill>
        <FieldLeft
          node={node}
          lead={lead}
          optional={optional}
          toggle={{ open, onToggle: () => setOpen((o) => !o) }}
        />
        <RightCell
          control={<ChoiceSegments node={node} branch={choiceValue.branch} onChange={onChange} />}
          trailing={trailing}
        />
      </RowShell>
      {open &&
        (isPlainSequence(selected) ? (
          <SequenceChildren node={selected} value={choiceValue.value} onChange={onBranchChange} depth={depth + 1} />
        ) : (
          <SchemaNodeField node={selected} value={choiceValue.value} onChange={onBranchChange} depth={depth + 1} />
        ))}
    </>
  );
}

/** Renders a node's kind (leaf / sequence / choice / any) as rows, ignoring the
 * node's optional/repeatable cardinality — those are resolved by the caller. */
function KindRows(props: RowProps) {
  const { node } = props;
  if (node.kind === "any") return <AnyRow {...props} />;
  if ("leaf" in node.kind) return <LeafRow {...props} />;
  if ("sequence" in node.kind) return <SequenceRows {...props} />;
  return <ChoiceRows {...props} />;
}

function RepeatableRows({ node, value, onChange, depth, lead, optional }: RowProps) {
  const [open, setOpen] = useState(true);
  const items =
    typeof value === "object" && value !== null && "repeated" in value ? value.repeated : [];
  return (
    <>
      <RowShell depth={depth} fill>
        <FieldLeft
          node={node}
          lead={lead}
          optional={optional}
          toggle={{ open, onToggle: () => setOpen((o) => !o) }}
        />
        <RightCell />
      </RowShell>
      {open && (
        <>
          {items.map((item, i) => (
            <KindRows
              key={i}
              node={node}
              value={item}
              depth={depth + 1}
              lead={
                <span className="px-[7px] py-[2px] rounded-[4px] bg-secondary text-[12px] font-mono text-foreground shrink-0">
                  {i}
                </span>
              }
              onChange={(v) => onChange({ repeated: items.map((it, j) => (j === i ? v : it)) })}
              trailing={
                <button
                  type="button"
                  aria-label={`remove ${node.name} ${i}`}
                  onClick={() => onChange({ repeated: items.filter((_, j) => j !== i) })}
                  className="flex items-center justify-center w-[32px] h-[32px] rounded-[6px] border border-border text-muted hover:text-foreground shrink-0 cursor-pointer"
                >
                  <X size={14} />
                </button>
              }
            />
          ))}
          <RowShell depth={depth + 1}>
            <button
              type="button"
              aria-label={`add ${node.name}`}
              onClick={() => onChange({ repeated: [...items, kindDefault(node)] })}
              className="flex items-center gap-[6px] px-[10px] py-[5px] rounded-[6px] border text-[12px] font-mono cursor-pointer"
              style={{ borderColor: "var(--color-soap-op)", color: "var(--color-soap-op)" }}
            >
              <Plus size={13} /> Add {node.name}
            </button>
          </RowShell>
        </>
      )}
    </>
  );
}

function PresentRows({ node, value, onChange, depth, lead, optional }: RowProps) {
  if (isRepeatable(node)) {
    return <RepeatableRows node={node} value={value} onChange={onChange} depth={depth} lead={lead} optional={optional} />;
  }

  if (node.nillable) {
    const isNil = value === "nil";
    const nilToggle = (
      <label className="flex items-center gap-1 text-[11px] text-muted shrink-0 cursor-pointer">
        <input
          type="checkbox"
          aria-label={`${node.name} nil`}
          className="w-[14px] h-[14px] accent-primary"
          checked={isNil}
          onChange={(e) => onChange(e.target.checked ? "nil" : kindDefault(node))}
        />
        nil
      </label>
    );
    if (isNil) {
      return (
        <RowShell depth={depth}>
          <FieldLeft node={node} lead={lead} optional={optional} />
          <RightCell trailing={nilToggle} />
        </RowShell>
      );
    }
    return (
      <KindRows node={node} value={value} onChange={onChange} depth={depth} lead={lead} optional={optional} trailing={nilToggle} />
    );
  }

  return <KindRows node={node} value={value} onChange={onChange} depth={depth} lead={lead} optional={optional} />;
}

export function SchemaNodeField({ node, value, onChange, depth = 0, root = false }: SchemaNodeFieldProps) {
  if (root && isPlainSequence(node)) {
    return <SequenceChildren node={node} value={value} onChange={onChange} depth={depth} />;
  }

  if (node.occurs.min === 0) {
    const present = value !== "omitted";
    const box = (
      <input
        type="checkbox"
        aria-label={`${node.name} present`}
        className="w-[14px] h-[14px] shrink-0 accent-primary"
        checked={present}
        onChange={(e) => onChange(e.target.checked ? presentDefault(node) : "omitted")}
      />
    );
    if (!present) {
      return (
        <RowShell depth={depth}>
          <FieldLeft node={node} lead={box} optional />
          <RightCell />
        </RowShell>
      );
    }
    return <PresentRows node={node} value={value} onChange={onChange} depth={depth} lead={box} optional />;
  }

  return <PresentRows node={node} value={value} onChange={onChange} depth={depth} />;
}
