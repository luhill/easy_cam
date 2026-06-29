import { useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { OPERATION_TEMPLATES } from '../types/operations';

export function FileUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { stlFileName, stlUrl, setStlFile, loadDefaultStl, clearStl } = useAppStore();
  const isDev = import.meta.env.DEV;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.stl')) {
      setStlFile(file);
    }
  };

  return (
    <div className="file-upload">
      <input
        ref={inputRef}
        type="file"
        accept=".stl"
        onChange={handleFile}
        hidden
      />
      {stlUrl ? (
        <div className="file-info">
          <span className="file-name" title={stlFileName ?? 'STL model'}>
            {stlFileName ?? 'STL model'}
          </span>
          <button className="btn-icon" onClick={clearStl} title="Remove file">
            ✕
          </button>
        </div>
      ) : (
        <div className="file-upload-actions">
          <button className="btn btn-secondary" onClick={() => inputRef.current?.click()}>
            Upload STL
          </button>
          {isDev && (
            <button className="btn btn-secondary" onClick={loadDefaultStl} title="Load bundled sample part">
              Load sample
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function OperationPalette() {
  const addOperation = useAppStore((s) => s.addOperation);
  const hasStl = useAppStore((s) => !!s.stlUrl);

  return (
    <div className="operation-palette">
      <h3 className="panel-title">Operations</h3>
      <div className="palette-grid">
        {OPERATION_TEMPLATES.map((tmpl) => (
          <button
            key={tmpl.type}
            className="palette-item"
            onClick={() => addOperation(tmpl.type)}
            disabled={!hasStl}
            title={tmpl.description}
          >
            <span className="palette-icon">{tmpl.icon}</span>
            <span className="palette-label">{tmpl.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
