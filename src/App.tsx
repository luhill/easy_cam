import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useSettingsStore } from './store/useSettingsStore';
import { StlViewer } from './components/Viewer/StlViewer';
import { FileUpload } from './components/FileUpload';
import { Sidebar } from './components/Sidebar';
import { ToolpathStatus } from './components/ToolpathStatus';
import { generateGcode, downloadGcode } from './lib/gcode';
import './App.css';

function GcodePanel() {
  const operations = useAppStore((s) => s.operations);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const gcodeTemplates = useSettingsStore((s) => s.gcodeTemplates);
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const safeHeight = useSettingsStore((s) => s.safeHeight);
  const partBounds = useAppStore((s) => s.partBounds);
  const enabledCount = operations.filter((o) => o.enabled).length;

  const handleExport = () => {
    const stockTop = partBounds?.maxZ ?? 0;
    const gcode = generateGcode(operations, toolpaths, gcodeTemplates, toolOrigin, stockTop, safeHeight);
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
        <Sidebar />
        <section className="viewer-panel">
          <ToolpathStatus />
          <StlViewer />
        </section>
      </main>
    </div>
  );
}
