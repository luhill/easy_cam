import { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { StlViewer } from './components/Viewer/StlViewer';
import { FileUpload } from './components/FileUpload';
import { Sidebar } from './components/Sidebar';
import { FeedsCalculatorSidebar } from './components/FeedsCalculatorSidebar';
import { ToolpathStatus } from './components/ToolpathStatus';
import './App.css';

export default function App() {
  const [feedsCalculatorOpen, setFeedsCalculatorOpen] = useState(false);

  useEffect(() => {
    useAppStore.getState().regenerateToolpaths();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <h1>Easy CAM</h1>
          <span className="header-subtitle">CNC Router CAM</span>
        </div>
        <div className="header-actions">
          <FileUpload />
        </div>
      </header>

      <main className="app-main">
        <div className="sidebar-stack">
          <Sidebar />
          <FeedsCalculatorSidebar
            open={feedsCalculatorOpen}
            onToggle={() => setFeedsCalculatorOpen((v) => !v)}
          />
        </div>
        <section className="viewer-panel">
          <ToolpathStatus />
          <StlViewer />
        </section>
      </main>
    </div>
  );
}
