import { useEffect } from "react";
import { CentralPanel } from "./components/CentralPanel";
import { Titlebar } from "./components/Titlebar";
import { useWorkspaceStore, initWorkspaceStore } from "./store/workspaceStore";
import { useCollectionStore } from "./store/collectionStore";

function App() {
  const activeId = useWorkspaceStore((s) => s.activeId);
  const loadCollections = useCollectionStore((s) => s.load);
  const setActiveRequest = useCollectionStore((s) => s.setActiveRequest);

  useEffect(() => {
    initWorkspaceStore();
  }, []);

  useEffect(() => {
    setActiveRequest(null);
    loadCollections(activeId);
  }, [activeId, loadCollections, setActiveRequest]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Titlebar />
      <div className="flex-1 overflow-hidden">
        <CentralPanel />
      </div>
    </div>
  );
}

export default App;
