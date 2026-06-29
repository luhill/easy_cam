import { useCallback, useEffect, useState } from 'react';
import { createFaceColorAttribute } from '../lib/faceColors';
import {
  processStlGeometry,
  type ProcessedMesh,
} from '../lib/geometryProcessing';
import { loadStlGeometry } from '../lib/stlLoader';
import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';

export function useProcessedStl(stlUrl: string | null) {
  const setPartBounds = useAppStore((s) => s.setPartBounds);
  const setToolOriginFromBounds = useSettingsStore((s) => s.setToolOriginFromBounds);

  const [processedMesh, setProcessedMesh] = useState<ProcessedMesh | null>(null);
  const [meshKey, setMeshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!stlUrl) {
      setProcessedMesh(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setProcessedMesh(null);

    loadStlGeometry(stlUrl)
      .then((rawGeometry) => {
        if (cancelled) return;
        const mesh = processStlGeometry(rawGeometry);
        createFaceColorAttribute(mesh.geometry);
        setProcessedMesh(mesh);
        setMeshKey((k) => k + 1);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('STL load failed:', error);
        setLoadError(error instanceof Error ? error.message : 'Failed to load STL');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [stlUrl]);

  useEffect(() => {
    if (!processedMesh) return;
    setPartBounds(processedMesh.bounds);
    setToolOriginFromBounds(processedMesh.bounds);
  }, [processedMesh, meshKey, setPartBounds, setToolOriginFromBounds]);

  const updateMesh = useCallback((mesh: ProcessedMesh) => {
    setProcessedMesh(mesh);
    setMeshKey((k) => k + 1);
  }, []);

  return {
    processedMesh,
    meshKey,
    loading,
    loadError,
    updateMesh,
  };
}
