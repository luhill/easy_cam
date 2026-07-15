import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { OPERATION_TEMPLATES } from '../types/operations';

function isStlFile(file: File | undefined | null): file is File {
  return !!file && file.name.toLowerCase().endsWith('.stl');
}

export function FileUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const { stlFileName, stlUrl, setStlFile, loadDefaultStl, clearStl } = useAppStore();

  const acceptStl = useCallback(
    (file: File | undefined | null) => {
      if (isStlFile(file)) setStlFile(file);
    },
    [setStlFile]
  );

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptStl(e.target.files?.[0]);
    e.target.value = '';
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    acceptStl(file);
  };

  return (
    <div
      className={`file-upload${dragOver ? ' file-upload-dragover' : ''}`}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => inputRef.current?.click()}
            title="Replace with another STL"
          >
            Replace
          </button>
        </div>
      ) : (
        <div className="file-upload-actions">
          <button className="btn btn-secondary" onClick={() => inputRef.current?.click()}>
            Upload STL
          </button>
          <button className="btn btn-secondary" onClick={loadDefaultStl} title="Load bundled sample part">
            Load sample
          </button>
          <span className="file-drop-hint">or drop .stl here</span>
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
