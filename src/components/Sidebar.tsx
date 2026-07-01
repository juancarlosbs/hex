import {
  ChevronDown,
  Folder,
  FolderPlus,
  Hexagon,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  DELETE: "text-method-delete",
  PUT: "text-method-put",
  PATCH: "text-method-post",
};

function RestRequest({
  method,
  path,
  active,
}: {
  method: string;
  path: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[6px] px-2 py-[6px] cursor-pointer ${active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"}`}
      style={{ paddingLeft: 24 }}
    >
      <span
        className={`w-10 text-right text-[10px] font-bold font-mono shrink-0 ${METHOD_COLORS[method] ?? "text-sidebar-muted"}`}
      >
        {method}
      </span>
      <span
        className={`text-[12px] font-mono ${active ? "text-foreground" : "text-sidebar-muted"}`}
      >
        {path}
      </span>
    </div>
  );
}

function SoapOperation({ name }: { name: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-[6px] cursor-pointer hover:bg-sidebar-accent/50"
      style={{ padding: "6px 8px 6px 40px" }}
    >
      <div className="w-10 flex justify-end shrink-0">
        <Hexagon size={14} className="text-soap-op" />
      </div>
      <span className="text-[12px] font-mono text-sidebar-muted">{name}</span>
    </div>
  );
}

function FolderRow({ name, tag }: { name: string; tag?: string }) {
  return (
    <div className="flex items-center gap-[6px] rounded-[6px] px-2 py-[7px] cursor-pointer hover:bg-sidebar-accent/50">
      <ChevronDown size={14} className="text-sidebar-muted shrink-0" />
      <Folder size={14} className="text-sidebar-muted shrink-0" />
      <span className="text-[13px] font-semibold text-foreground">{name}</span>
      {tag && (
        <span className="text-[10px] font-mono text-sidebar-muted">{tag}</span>
      )}
    </div>
  );
}

function BindingRow({ name, version }: { name: string; version: string }) {
  return (
    <div
      className="flex items-center gap-[6px] rounded-[6px] cursor-pointer hover:bg-sidebar-accent/50"
      style={{ padding: "6px 8px 6px 24px" }}
    >
      <ChevronDown size={14} className="text-sidebar-muted shrink-0" />
      <span className="text-[12px] font-medium text-foreground">{name}</span>
      <span className="text-[10px] font-mono text-soap-op">{version}</span>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside
      className="flex flex-col h-full w-[264px] shrink-0 border-r border-border"
      style={{ backgroundColor: "var(--color-sidebar)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span
          className="text-[11px] font-semibold tracking-[0.5px] text-sidebar-muted"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          WORKSPACE
        </span>
        <div className="flex items-center gap-1">
          <FolderPlus size={14} className="text-sidebar-muted cursor-pointer hover:text-foreground" />
          <Plus size={14} className="text-sidebar-muted cursor-pointer hover:text-foreground" />
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 px-[9px] py-[7px] rounded-[6px] bg-background border border-border cursor-text">
          <Search size={13} className="text-sidebar-muted shrink-0" />
          <span className="text-[12px] text-sidebar-muted">Filter requests</span>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-[6px] py-1 flex flex-col gap-px">
        <FolderRow name="Collections" />
        <RestRequest method="GET" path="/users" />
        <RestRequest method="POST" path="/auth/token" active />
        <RestRequest method="DELETE" path="/sessions/:id" />
        <FolderRow name="Payment Service" tag="WSDL" />
        <BindingRow name="PaymentPort" version="SOAP 1.2" />
        <SoapOperation name="GetBalance" />
        <SoapOperation name="SimulateWithdraw" />
        <SoapOperation name="ReleaseAmount" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-2 px-3 py-[10px] border-t border-border cursor-pointer hover:text-foreground">
        <RefreshCw size={13} className="text-sidebar-muted" />
        <span className="text-[12px] font-medium text-sidebar-muted">
          Update Definition
        </span>
      </div>
    </aside>
  );
}
