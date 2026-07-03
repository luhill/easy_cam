import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  defaultGcodeFilename,
  generateGcode,
  saveGcodeFile,
} from '../lib/gcode';
import { OperationTimeEstimate } from './OperationTimeEstimate';

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="gcode-download-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function OperationsTabFooter() {
  const operations = useAppStore((s) => s.operations);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const stlFileName = useAppStore((s) => s.stlFileName);
  const partBounds = useAppStore((s) => s.partBounds);
  const gcodeTemplates = useSettingsStore((s) => s.gcodeTemplates);
  const gcodeOutputFormat = useSettingsStore((s) => s.gcodeOutputFormat);
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const safeHeight = useSettingsStore((s) => s.safeHeight);

  const enabledCount = operations.filter((o) => o.enabled).length;

  const handleDownload = useCallback(async () => {
    const gcode = generateGcode({
      operations,
      toolpaths,
      templates: gcodeTemplates,
      toolOrigin,
      stockTopWorldZ: partBounds?.maxZ ?? 0,
      safeHeight,
      format: gcodeOutputFormat,
    });
    await saveGcodeFile(gcode, defaultGcodeFilename(stlFileName));
  }, [
    operations,
    toolpaths,
    gcodeTemplates,
    toolOrigin,
    partBounds?.maxZ,
    safeHeight,
    gcodeOutputFormat,
    stlFileName,
  ]);

  const canDownload = operations.length > 0 && enabledCount > 0;

  return (
    <div className="operations-tab-footer">
      <OperationTimeEstimate />
      <button
        type="button"
        className="btn btn-small btn-primary gcode-download-btn"
        onClick={() => void handleDownload()}
        disabled={!canDownload}
        aria-label="Download G-code"
        title={
          operations.length === 0
            ? 'Add at least one operation to export G-code'
            : enabledCount === 0
              ? 'Enable at least one operation to export G-code'
              : `Download ${defaultGcodeFilename(stlFileName)}`
        }
      >
        <DownloadIcon />
      </button>
    </div>
  );
}
