import { Group, Panel, Separator } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { RequestPanel } from "./request/RequestPanel";
import { ResponsePlaceholder } from "./response/ResponsePlaceholder";

export function CentralPanel() {
  return (
    <Group orientation="horizontal" id="hex-central" className="flex h-full w-full">
      <Panel defaultSize={22} minSize={16} maxSize={40}>
        <Sidebar />
      </Panel>
      <Separator className="w-[1px] bg-border hover:bg-primary/40 transition-colors" />
      <Panel defaultSize={48} minSize={30}>
        <RequestPanel />
      </Panel>
      <Separator className="w-[1px] bg-border hover:bg-primary/40 transition-colors" />
      <Panel defaultSize={32} minSize={20}>
        <ResponsePlaceholder />
      </Panel>
    </Group>
  );
}
