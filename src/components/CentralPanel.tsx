import { Group, Panel, Separator } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { RequestPanel } from "./request/RequestPanel";
import { ResponsePanel } from "./response/ResponsePanel";

export function CentralPanel() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <Group orientation="horizontal" id="hex-central" className="flex flex-1 min-w-0 h-full">
        <Panel defaultSize={60} minSize={30}>
          <RequestPanel />
        </Panel>
        <Separator className="w-[1px] bg-border hover:bg-primary/40 transition-colors" />
        <Panel defaultSize={40} minSize={20}>
          <ResponsePanel />
        </Panel>
      </Group>
    </div>
  );
}
