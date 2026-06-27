import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { StlViewer } from './components/Viewer/StlViewer';
import { FileUpload, OperationPalette } from './components/FileUpload';
import { OperationList } from './components/Operations/OperationList';
import { generateGcode, downloadGcode } from './lib/gcode';
import './App.css';

function GcodePanel() {
  const operations = useAppStore((s) => s.operations);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const enabledCount = operations.filter((o) => o.enabled).length;

  const handleExport = () => {
    const gcode = generateGcode(operations, toolpaths);
    downloadGcode(gcode);
  };

  return (
    <div className="gcode-panel">
      <button
        className="btn btn-primary"
        onClick={handleExport}
        disabled={enabledCount === 0}
      >
        Export G-code ({enabledCount})
      </button>
    </div>
  );
}

export default function App() {
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
          <GcodePanel />
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <OperationPalette />
          <OperationList />
        </aside>
        <section className="viewer-panel">
          <StlViewer />
        </section>
      </main>
    </div>
  );
}
