// src/components/request/KeyValueTable.tsx
import { Check, Lock, Plus, Trash2 } from "lucide-react";
import { KeyValue } from "../../lib/request-types";
import { cn } from "../../lib/utils";

export interface KeyValueTableColumn {
  key: "key" | "value" | "description";
  label: string;
  placeholder: string;
}

interface KeyValueTableProps {
  rows: KeyValue[];
  columns: KeyValueTableColumn[];
  onChangeRow: (row: KeyValue) => void;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  /** Empty display row hint (visible last item to invite adding) — parity with Pencil design. */
  emptyRowHint?: boolean;
}

export function KeyValueTable(props: KeyValueTableProps) {
  const { rows, columns, onChangeRow, onAddRow, onRemoveRow, emptyRowHint = true } = props;

  return (
    <div className="flex flex-col w-full">
      {/* Column header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
        <div className="w-[14px]" aria-hidden />
        {columns.map((c) => (
          <div
            key={c.key}
            className="flex-1 text-[10px] font-semibold tracking-[0.6px] text-muted"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {c.label}
          </div>
        ))}
        <div className="w-[14px]" aria-hidden />
      </div>

      {rows.map((row) => (
        <Row key={row.id} row={row} columns={columns} onChange={onChangeRow} onRemove={onRemoveRow} />
      ))}

      {emptyRowHint && (
        <button
          type="button"
          onClick={onAddRow}
          className="flex items-center gap-3 px-3 py-[9px] border-b border-border text-left cursor-pointer hover:bg-secondary/40"
        >
          <div className="w-[14px] h-[14px] rounded-[3px] border border-border" aria-hidden />
          {columns.map((c) => (
            <span
              key={c.key}
              className="flex-1 text-[12px] text-muted opacity-50"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {c.placeholder}
            </span>
          ))}
          <Plus size={14} className="text-muted opacity-70" />
        </button>
      )}
    </div>
  );
}

function Row(props: {
  row: KeyValue;
  columns: KeyValueTableColumn[];
  onChange: (row: KeyValue) => void;
  onRemove: (id: string) => void;
}) {
  const { row, columns, onChange, onRemove } = props;
  const dim = row.auto || !row.enabled;

  return (
    <div className="flex items-center gap-3 px-3 py-[9px] border-b border-border">
      {row.auto ? (
        <div className="flex items-center justify-center w-[14px] h-[14px]" title="Auto-generated">
          <Lock size={10} className="text-muted" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onChange({ ...row, enabled: !row.enabled })}
          className={cn(
            "flex items-center justify-center w-[14px] h-[14px] rounded-[3px] border cursor-pointer",
            row.enabled ? "bg-primary border-primary" : "border-border",
          )}
          aria-label={row.enabled ? "Disable row" : "Enable row"}
        >
          {row.enabled && <Check size={10} className="text-primary-foreground" />}
        </button>
      )}

      {columns.map((c) => (
        <input
          key={c.key}
          value={row[c.key] ?? ""}
          placeholder={c.placeholder}
          disabled={row.auto}
          onChange={(e) => onChange({ ...row, [c.key]: e.target.value })}
          className={cn(
            "flex-1 min-w-0 bg-transparent outline-none text-[12px] placeholder:text-muted/50",
            dim ? "text-muted" : "text-foreground",
          )}
          style={{ fontFamily: c.key === "description" ? "var(--font-sans)" : "var(--font-mono)" }}
        />
      ))}

      {row.auto ? (
        <div className="w-[14px]" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          className="cursor-pointer text-muted hover:text-foreground"
          aria-label="Remove row"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
