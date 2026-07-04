import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import { useWorkspaceStore, initWorkspaceStore } from "./store/workspaceStore";
import { useCollectionStore } from "./store/collectionStore";

function App() {
  const activeId = useWorkspaceStore((s) => s.activeId);
  const loadCollections = useCollectionStore((s) => s.load);

  useEffect(() => {
    initWorkspaceStore();
  }, []);

  useEffect(() => {
    loadCollections(activeId);
  }, [activeId, loadCollections]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
      </div>
    </div>
  );
}

export default App;
