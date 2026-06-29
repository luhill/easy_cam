import { useAppStore } from '../store/useAppStore';

export function ToolpathWarnings() {
  const warnings = useAppStore((s) => s.toolpathWarnings);
  if (warnings.length === 0) return null;

  return (
    <div className="toolpath-warnings" role="alert">
      {warnings.map((message, index) => (
        <p key={index}>{message}</p>
      ))}
    </div>
  );
}
