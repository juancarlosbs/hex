import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { RequestPanel } from "./request/RequestPanel";
import { ResponsePlaceholder } from "./response/ResponsePlaceholder";

export function CentralPanel() {
  return (
    <PanelGroup direction="horizontal" autoSaveId="hex-central">
      <Panel defaultSize={20} minSize={12} maxSize={40}>
        <Sidebar />
      </Panel>
      <PanelResizeHandle className="w-[1px] bg-border hover:bg-primary/40 transition-colors" />
      <Panel defaultSize={48} minSize={30}>
        <RequestPanel />
      </Panel>
      <PanelResizeHandle className="w-[1px] bg-border hover:bg-primary/40 transition-colors" />
      <Panel defaultSize={32} minSize={20}>
        <ResponsePlaceholder />
      </Panel>
    </PanelGroup>
  );
}
