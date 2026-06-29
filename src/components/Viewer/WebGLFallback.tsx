interface WebGLFallbackProps {
  message: string;
  onRetry: () => void;
}

export function WebGLFallback({ message, onRetry }: WebGLFallbackProps) {
  return (
    <div className="viewer-webgl-error">
      <p className="viewer-webgl-error-title">3D viewer unavailable</p>
      <p className="viewer-webgl-error-message">{message}</p>
      <ul className="viewer-webgl-error-tips">
        <li>Open the app in a local browser (not the cloud IDE preview) if you are on a remote session.</li>
        <li>In Chrome, enable Settings → System → “Use hardware acceleration when available”, then relaunch.</li>
        <li>Close other tabs running WebGL/3D apps, then reload this page.</li>
      </ul>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
