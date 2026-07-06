import { useAppStore } from '../store/useAppStore';
import { MAX_TOOLPATH_POINTS } from '../lib/toolpaths';

export function ToolpathStatus() {
  const toolpaths = useAppStore((s) => s.toolpaths);
  const warnings = useAppStore((s) => s.toolpathWarnings);
  const totalPoints = toolpaths.reduce((sum, seg) => sum + seg.points.length, 0);

  if (totalPoints === 0 && warnings.length === 0) return null;

  return (
    <div
      className={`toolpath-status${warnings.length > 0 ? ' toolpath-status--warn' : ''}`}
      role="status"
    >
      <p className="toolpath-status-count">
        Toolpath points: {totalPoints.toLocaleString()} /{' '}
        {MAX_TOOLPATH_POINTS.toLocaleString()}
      </p>
      {warnings.map((message, index) => (
        <p key={index} className="toolpath-status-warning">
          {message}
        </p>
      ))}
    </div>
  );
}
