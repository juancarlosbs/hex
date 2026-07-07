// src/components/request/ParamsTab.tsx
import { ArrowUpDown, List, Plus } from "lucide-react";
import { KeyValueTable } from "./KeyValueTable";
import { useRequestStore } from "../../store/requestStore";

interface ParamsTabProps {
  requestId: string;
}

export function ParamsTab({ requestId }: ParamsTabProps) {
  const params = useRequestStore((s) => s.openRequests[requestId]?.params ?? []);
  const setKV = useRequestStore((s) => s.setKV);
  const addKV = useRequestStore((s) => s.addKV);
  const removeKV = useRequestStore((s) => s.removeKV);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-[6px] text-muted">
          <List size={13} />
          <span className="text-[12px]" style={{ fontFamily: "var(--font-sans)" }}>
            {params.length} {params.length === 1 ? "param" : "params"}
          </span>
        </div>
        <div className="flex-1" />
        <ArrowUpDown size={14} className="text-muted cursor-pointer hover:text-foreground" />
        <Plus
          size={14}
          className="text-muted cursor-pointer hover:text-foreground"
          onClick={() => addKV(requestId, "params")}
        />
      </div>

      <KeyValueTable
        rows={params}
        columns={[
          { key: "key", label: "KEY", placeholder: "Key" },
          { key: "value", label: "VALUE", placeholder: "Value" },
          { key: "description", label: "DESCRIPTION", placeholder: "Description" },
        ]}
        onChangeRow={(row) => setKV(requestId, "params", row)}
        onAddRow={() => addKV(requestId, "params")}
        onRemoveRow={(id) => removeKV(requestId, "params", id)}
      />
    </div>
  );
}
