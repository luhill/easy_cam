import * as THREE from 'three';

export type WebGLSupportResult = {
  supported: boolean;
  version: 'webgl2' | 'webgl' | null;
  message?: string;
};

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: true,
  stencil: false,
  failIfMajorPerformanceCaveat: false,
  powerPreference: 'low-power',
  preserveDrawingBuffer: false,
};

function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | WebGLRenderingContext | null {
  const webgl2 = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  if (webgl2) return webgl2;

  const webgl =
    canvas.getContext('webgl', CONTEXT_ATTRIBUTES) ??
    canvas.getContext('experimental-webgl', CONTEXT_ATTRIBUTES);
  return webgl as WebGLRenderingContext | null;
}

export function detectWebGLSupport(): WebGLSupportResult {
  if (typeof document === 'undefined') {
    return { supported: false, version: null, message: 'WebGL is unavailable during server rendering.' };
  }

  try {
    const canvas = document.createElement('canvas');
    const context = createContext(canvas);
    if (!context) {
      return {
        supported: false,
        version: null,
        message:
          'WebGL could not be initialized in this browser. Remote desktops and some cloud IDE browsers block GPU access — try opening the dev server URL in Chrome or Safari on your local machine.',
      };
    }

    return {
      supported: true,
      version: context instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
    };
  } catch (error) {
    return {
      supported: false,
      version: null,
      message: error instanceof Error ? error.message : 'WebGL probe failed.',
    };
  }
}

export function createViewerRenderer(defaultProps: Record<string, unknown> & {
  canvas: HTMLCanvasElement | OffscreenCanvas;
}): THREE.WebGLRenderer {
  const { canvas } = defaultProps;
  if (!(canvas instanceof HTMLCanvasElement)) {
    return new THREE.WebGLRenderer({
      ...defaultProps,
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
  }

  const context = createContext(canvas);
  if (!context) {
    throw new Error('Could not create a WebGL context.');
  }

  const renderer = new THREE.WebGLRenderer({
    ...defaultProps,
    canvas,
    context,
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  return renderer;
}
