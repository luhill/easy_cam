import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { useSettingsStore } from './store/useSettingsStore';
import { StlViewer } from './components/Viewer/StlViewer';
import { FileUpload } from './components/FileUpload';
import { Sidebar } from './components/Sidebar';
import { FeedsCalculatorSidebar } from './components/FeedsCalculatorSidebar';
import { ToolpathStatus } from './components/ToolpathStatus';
import './App.css';

export default function App() {
  const [feedsCalculatorOpen, setFeedsCalculatorOpen] = useState(false);
  const [viewerDragOver, setViewerDragOver] = useState(false);
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const setStlFile = useAppStore((s) => s.setStlFile);

  useEffect(() => {
    useAppStore.getState().regenerateToolpaths();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = uiTheme;
    const themeColor = uiTheme === 'light' ? '#ffffff' : '#1a1d23';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  }, [uiTheme]);

  const onViewerDragOver = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    setViewerDragOver(true);
  }, []);

  const onViewerDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setViewerDragOver(false);
  }, []);

  const onViewerDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setViewerDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.name.toLowerCase().endsWith('.stl')) {
        setStlFile(file);
      }
    },
    [setStlFile]
  );

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
        <section
          className={`viewer-panel${viewerDragOver ? ' viewer-panel-dragover' : ''}`}
          onDragOver={onViewerDragOver}
          onDragEnter={onViewerDragOver}
          onDragLeave={onViewerDragLeave}
          onDrop={onViewerDrop}
        >
          <ToolpathStatus />
          <StlViewer />
          {viewerDragOver ? <div className="viewer-drop-overlay">Drop STL to load</div> : null}
        </section>
      </main>
    </div>
  );
}
