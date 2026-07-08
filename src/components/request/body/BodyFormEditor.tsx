import { ChevronDown, File, Type, X } from "lucide-react";
import { useState } from "react";
import { KeyValue } from "../../../lib/request-types";
import { KeyValueTable } from "../KeyValueTable";
import { useRequestStore } from "../../../store/requestStore";
import { cn } from "../../../lib/utils";

interface BodyFormEditorProps {
  requestId: string;
  multipart: boolean;
}

export function BodyFormEditor({ requestId, multipart }: BodyFormEditorProps) {
  const rows = useRequestStore((s) => s.openRequests[requestId]?.body.form ?? []);
  const setFormRow = useRequestStore((s) => s.setFormRow);
  const addFormRow = useRequestStore((s) => s.addFormRow);
  const removeFormRow = useRequestStore((s) => s.removeFormRow);

  if (!multipart) {
    return (
      <KeyValueTable
        rows={rows}
        columns={[
          { key: "key", label: "KEY", placeholder: "Key" },
          { key: "value", label: "VALUE", placeholder: "Value" },
        ]}
        onChangeRow={(row) => setFormRow(requestId, row)}
        onAddRow={() => addFormRow(requestId)}
        onRemoveRow={(id) => removeFormRow(requestId, id)}
      />
    );
  }

  return (
    <MultipartTable
      rows={rows}
      onChangeRow={(row) => setFormRow(requestId, row)}
      onAddRow={() => addFormRow(requestId)}
      onRemoveRow={(id) => removeFormRow(requestId, id)}
    />
  );
}

function MultipartTable(props: {
  rows: KeyValue[];
  onChangeRow: (row: KeyValue) => void;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
}) {
  const { rows, onChangeRow, onAddRow, onRemoveRow } = props;

  return (
    <div className="flex flex-col w-full">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
        <div className="w-[14px]" />
        <div className="flex-1 text-[10px] font-semibold tracking-[0.6px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>KEY</div>
        <div className="text-[10px] font-semibold tracking-[0.6px] text-muted w-[76px]" style={{ fontFamily: "var(--font-sans)" }}>TYPE</div>
        <div className="flex-1 text-[10px] font-semibold tracking-[0.6px] text-muted" style={{ fontFamily: "var(--font-sans)" }}>VALUE</div>
        <div className="w-[14px]" />
      </div>

      {rows.map((row) => (
        <MultipartRow key={row.id} row={row} onChange={onChangeRow} onRemove={onRemoveRow} />
      ))}

      <button
        type="button"
        onClick={onAddRow}
        className="flex items-center gap-3 px-3 py-[9px] border-b border-border text-left cursor-pointer hover:bg-secondary/40"
      >
        <div className="w-[14px] h-[14px] rounded-[3px] border border-border" />
        <span className="flex-1 text-[12px] text-muted opacity-50" style={{ fontFamily: "var(--font-mono)" }}>Key</span>
        <span className="w-[76px] text-[10px] text-muted opacity-50">Text</span>
        <span className="flex-1 text-[12px] text-muted opacity-50" style={{ fontFamily: "var(--font-mono)" }}>Value</span>
        <div className="w-[14px]" />
      </button>
    </div>
  );
}

function MultipartRow(props: {
  row: KeyValue;
  onChange: (row: KeyValue) => void;
  onRemove: (id: string) => void;
}) {
  const { row, onChange, onRemove } = props;
  const [typeOpen, setTypeOpen] = useState(false);
  const isFile = row.type === "file";

  return (
    <div className="flex items-center gap-3 px-3 py-[9px] border-b border-border">
      <button
        type="button"
        onClick={() => onChange({ ...row, enabled: !row.enabled })}
        className={cn(
          "flex items-center justify-center w-[14px] h-[14px] rounded-[3px] border cursor-pointer",
          row.enabled ? "bg-primary border-primary" : "border-border",
        )}
      />

      <input
        value={row.key}
        onChange={(e) => onChange({ ...row, key: e.target.value })}
        placeholder="Key"
        className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-foreground placeholder:text-muted/50"
        style={{ fontFamily: "var(--font-mono)" }}
      />

      <div className="relative w-[76px]">
        <button
          type="button"
          onClick={() => setTypeOpen((v) => !v)}
          className="w-full flex items-center gap-[4px] px-[7px] py-[3px] rounded-[4px] bg-secondary border border-border cursor-pointer"
        >
          {isFile ? <File size={11} className="text-muted" /> : <Type size={11} className="text-muted" />}
          <span className="text-[10px] font-semibold text-foreground flex-1 text-left" style={{ fontFamily: "var(--font-sans)" }}>
            {isFile ? "File" : "Text"}
          </span>
          <ChevronDown size={10} className="text-muted" />
        </button>
        {typeOpen && (
          <ul className="absolute left-0 top-[calc(100%+2px)] z-30 w-full rounded-[4px] bg-card border border-border shadow-lg p-1">
            {(["text", "file"] as const).map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ ...row, type: t, value: "" });
                    setTypeOpen(false);
                  }}
                  className="w-full text-left text-[10px] px-2 py-1 rounded-[3px] hover:bg-secondary text-foreground"
                >
                  {t === "text" ? "Text" : "File"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isFile ? (
        <FileValue row={row} onChange={onChange} />
      ) : (
        <input
          value={row.value}
          onChange={(e) => onChange({ ...row, value: e.target.value })}
          placeholder="Value"
          className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-foreground placeholder:text-muted/50"
          style={{ fontFamily: "var(--font-mono)" }}
        />
      )}

      <button
        type="button"
        onClick={() => onRemove(row.id)}
        className="cursor-pointer text-muted hover:text-foreground"
        aria-label="Remove row"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function FileValue({ row, onChange }: { row: KeyValue; onChange: (row: KeyValue) => void }) {
  const has = row.value.length > 0;
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2">
      {has ? (
        <span
          className="flex items-center gap-[6px] px-[8px] py-[3px] rounded-[4px] border"
          style={{ background: "var(--color-soap-op-surface)", borderColor: "var(--color-soap-op)" }}
        >
          <File size={11} style={{ color: "var(--color-soap-op)" }} />
          <span
            className="text-[11px]"
            style={{ color: "var(--color-soap-op)", fontFamily: "var(--font-mono)" }}
          >
            {row.value}
          </span>
          <button
            type="button"
            onClick={() => onChange({ ...row, value: "" })}
            className="cursor-pointer"
            aria-label="Clear file"
          >
            <X size={11} style={{ color: "var(--color-soap-op)" }} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() =>
            // ponytail: file picker dialog is engine-plan territory. For now, set a stub filename
            // so the chip renders. Wire to tauri-plugin-dialog::open in the engine plan.
            onChange({ ...row, value: "example.pdf" })
          }
          className="text-[12px] text-muted underline underline-offset-2 cursor-pointer hover:text-foreground"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Choose file…
        </button>
      )}
    </div>
  );
}
