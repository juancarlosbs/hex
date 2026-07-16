// src/components/request/HeadersTab.tsx
import { EyeOff, List, Lock, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { KeyValueTable } from "./KeyValueTable";
import { useRequestStore } from "../../store/requestStore";
import { KeyValue } from "../../lib/request-types";

interface HeadersTabProps {
  requestId: string;
}

/** Static list of headers the engine sets automatically. Displayed read-only. */
const AUTO_HEADERS: KeyValue[] = [
  { id: "auto-host", key: "Host", value: "(derived from URL)", enabled: true, auto: true },
  { id: "auto-ct", key: "Content-Type", value: "(derived from body mode)", enabled: true, auto: true },
  { id: "auto-ua", key: "User-Agent", value: "hex/0.1.0", enabled: true, auto: true },
];

export function HeadersTab({ requestId }: HeadersTabProps) {
  const headers = useRequestStore((s) => s.openRequests[requestId]?.headers ?? []);
  const setKV = useRequestStore((s) => s.setKV);
  const addKV = useRequestStore((s) => s.addKV);
  const removeKV = useRequestStore((s) => s.removeKV);
  const [hideAuto, setHideAuto] = useState(false);

  const rows = useMemo(
    () => (hideAuto ? headers : [...headers, ...AUTO_HEADERS]),
    [headers, hideAuto],
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-[6px] text-muted">
          <List size={13} />
          <span className="text-[12px]" style={{ fontFamily: "var(--font-sans)" }}>
            {headers.length + AUTO_HEADERS.length} headers
          </span>
        </div>
        <div
          className="flex items-center gap-[4px] px-[6px] py-[2px] rounded-full border"
          style={{ borderColor: "var(--color-soap-op)", background: "var(--color-soap-op-surface)" }}
          title="Auto-generated"
        >
          <Lock size={9} style={{ color: "var(--color-soap-op)" }} />
          <span
            className="text-[10px] font-semibold"
            style={{ color: "var(--color-soap-op)", fontFamily: "var(--font-sans)" }}
          >
            {AUTO_HEADERS.length} auto
          </span>
        </div>
        <div className="flex-1" />
        <EyeOff
          size={14}
          className={`cursor-pointer ${hideAuto ? "text-foreground" : "text-muted hover:text-foreground"}`}
          onClick={() => setHideAuto((v) => !v)}
          aria-label="Toggle auto headers"
        />
        <Plus
          size={14}
          className="text-muted cursor-pointer hover:text-foreground"
          onClick={() => addKV(requestId, "headers")}
        />
      </div>

      <KeyValueTable
        rows={rows}
        columns={[
          { key: "key", label: "KEY", placeholder: "Header" },
          { key: "value", label: "VALUE", placeholder: "Value" },
        ]}
        onChangeRow={(row) => {
          if (row.auto) return;
          setKV(requestId, "headers", row);
        }}
        onAddRow={() => addKV(requestId, "headers")}
        onRemoveRow={(id) => removeKV(requestId, "headers", id)}
      />
    </div>
  );
}
