/** Bundled sample part for local development and testing. */
export const DEFAULT_DEV_STL_NAME = 'easycam.stl';

/** Increment when public/samples/easycam.stl is replaced (dev cache bust). */
const SAMPLE_STL_REVISION = 2;

const DEFAULT_DEV_STL_PATH = `${import.meta.env.BASE_URL}samples/easycam.stl`;

/** Dev URL with optional cache-bust token so updated sample files reload cleanly. */
export function getDefaultDevStlUrl(cacheBust?: string | number): string {
  if (!import.meta.env.DEV || cacheBust === undefined) {
    return DEFAULT_DEV_STL_PATH;
  }
  return `${DEFAULT_DEV_STL_PATH}?v=${encodeURIComponent(String(cacheBust))}`;
}

/** Initial dev auto-load URL. */
export const DEFAULT_DEV_STL_URL = getDefaultDevStlUrl(
  import.meta.env.DEV ? SAMPLE_STL_REVISION : undefined
);

/** Public demo URL (GitHub Pages). Works on phones/tablets with WebGL. */
export const PUBLIC_APP_URL = 'https://luhill.github.io/easy_cam/';
