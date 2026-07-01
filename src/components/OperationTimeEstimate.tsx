import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { estimateToolpathTime, formatDuration } from '../lib/toolpathTimeEstimate';
import { HintTooltip } from './HintTooltip';

export function OperationTimeEstimate() {
  const operations = useAppStore((s) => s.operations);
  const toolpaths = useAppStore((s) => s.toolpaths);

  const estimate = useMemo(
    () => estimateToolpathTime(operations, toolpaths),
    [operations, toolpaths]
  );

  if (operations.length === 0) return null;

  return (
    <div className="operation-time-estimate">
      <span className="operation-time-label">
        Est. time
        <HintTooltip text="Rough estimate from toolpath length and feed rates (cut, plunge, and rapid moves). Does not include spindle ramp or tool-change delays." />
      </span>
      <span className="operation-time-value">
        {estimate.enabledOperationCount === 0
          ? '—'
          : formatDuration(estimate.totalSeconds)}
      </span>
    </div>
  );
}
