import { PUBLIC_APP_URL } from '../../lib/defaultStl';

interface WebGLFallbackProps {
  message: string;
  onRetry: () => void;
  show2dHint?: boolean;
}

export function WebGLFallback({ message, onRetry, show2dHint = false }: WebGLFallbackProps) {
  return (
    <div className="viewer-webgl-banner">
      <div className="viewer-webgl-banner-copy">
        <p className="viewer-webgl-error-title">3D viewer unavailable in this browser</p>
        <p className="viewer-webgl-error-message">{message}</p>
        {show2dHint && (
          <p className="viewer-webgl-error-message">
            A 2D top-down preview is shown below. Geometry picking still needs a WebGL-capable
            browser.
          </p>
        )}
        <details className="viewer-webgl-help">
          <summary>How to open the full 3D viewer on iPad / iPhone</summary>
          <ul className="viewer-webgl-error-tips">
            <li>
              <strong>Do not use the Vite “Network” IP</strong> (for example{' '}
              <code>172.x.x.x:5173</code>) — that address only exists inside the cloud VM and
              cannot be reached from your phone, even on a hotspot.
            </li>
            <li>
              <strong>GitHub Pages (recommended for phone/tablet):</strong> after this branch merges
              to <code>main</code>, open{' '}
              <a href={PUBLIC_APP_URL} target="_blank" rel="noreferrer">
                {PUBLIC_APP_URL}
              </a>{' '}
              in Safari on your iPhone or iPad. That URL works from anywhere and supports WebGL.
            </li>
            <li>
              <strong>Cursor port forwarding (Mac/PC with Cursor desktop):</strong> click the plug
              icon in the agent panel, forward port <code>5173</code>, then open{' '}
              <code>http://localhost:5173</code> in Chrome/Safari on the <em>same computer</em>{' '}
              running Cursor — not on a separate phone.
            </li>
          </ul>
        </details>
      </div>
      <button type="button" className="btn btn-secondary btn-small" onClick={onRetry}>
        Retry 3D
      </button>
    </div>
  );
}
