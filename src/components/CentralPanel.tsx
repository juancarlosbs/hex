import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { ActivityBar } from "./ActivityBar";
import { RequestTabsBar } from "./request/RequestTabsBar";
import { RequestPanel } from "./request/RequestPanel";
import { ResponsePanel } from "./response/ResponsePanel";
import { HistoryDrawer } from "./response/HistoryDrawer";
import { COMPACT_MQ, useMediaQuery } from "../lib/useMediaQuery";

export function CentralPanel() {
  const compact = useMediaQuery(COMPACT_MQ);
  return compact ? <CompactLayout /> : <WideLayout />;
}

function WideLayout() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <Group orientation="horizontal" id="hex-central" className="flex flex-1 min-w-0 h-full">
        <Panel defaultSize={60} minSize={30}>
          <div className="flex flex-col h-full">
            <RequestTabsBar />
            <div className="flex-1 min-h-0">
              <RequestPanel />
            </div>
          </div>
        </Panel>
        <Separator className="w-[1px] bg-border hover:bg-primary/40 transition-colors" />
        <Panel defaultSize={40} minSize={20}>
          <div className="relative h-full">
            <ResponsePanel />
            <HistoryDrawer />
          </div>
        </Panel>
      </Group>
    </div>
  );
}

function CompactLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="relative flex h-full w-full">
      <ActivityBar
        collectionsActive={drawerOpen}
        onToggleCollections={() => setDrawerOpen((o) => !o)}
      />
      <Group orientation="vertical" id="hex-central-compact" className="flex flex-col flex-1 min-w-0 h-full">
        <Panel defaultSize={55} minSize={30}>
          <div className="flex flex-col h-full">
            <RequestTabsBar />
            <div className="flex-1 min-h-0">
              <RequestPanel />
            </div>
          </div>
        </Panel>
        <Separator className="h-[1px] bg-border hover:bg-primary/40 transition-colors" />
        <Panel defaultSize={45} minSize={20}>
          <div className="relative h-full">
            <ResponsePanel />
            <HistoryDrawer />
          </div>
        </Panel>
      </Group>
      {drawerOpen && (
        <div className="absolute inset-y-0 left-12 right-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-xl">
            <Sidebar />
          </div>
        </div>
      )}
    </div>
  );
}
