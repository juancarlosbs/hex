import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";

function App() {
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
