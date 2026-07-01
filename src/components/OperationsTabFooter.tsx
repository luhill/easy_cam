import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  defaultGcodeFilename,
  generateGcode,
  saveGcodeFile,
} from '../lib/gcode';
import { OperationTimeEstimate } from './OperationTimeEstimate';

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

  if (operations.length === 0) return null;

  return (
    <div className="operations-tab-footer">
      <OperationTimeEstimate />
      <button
        type="button"
        className="btn btn-small btn-primary gcode-download-btn"
        onClick={() => void handleDownload()}
        disabled={enabledCount === 0}
        title={
          enabledCount === 0
            ? 'Enable at least one operation to export G-code'
            : `Download ${defaultGcodeFilename(stlFileName)}`
        }
      >
        Download G-code
      </button>
    </div>
  );
}
