import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createFaceColorAttribute } from '../lib/faceColors';
import {
  finalizePartPlacement,
  processStlGeometry,
  rotateGeometryAroundZ,
  type ProcessedMesh,
} from '../lib/geometryProcessing';
import { loadStlGeometry } from '../lib/stlLoader';
import { registerPartTransformBridge } from '../lib/partTransformBridge';
import { useAppStore } from '../store/useAppStore';

export function useProcessedStl(stlUrl: string | null) {
  const setPartBounds = useAppStore((s) => s.setPartBounds);

  const [processedMesh, setProcessedMesh] = useState<ProcessedMesh | null>(null);
  const [meshKey, setMeshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sourceGeometryRef = useRef<THREE.BufferGeometry | null>(null);

  const applyOrientation = useCallback((rotationZDeg: number) => {
    const source = sourceGeometryRef.current;
    if (!source) return;

    const geo = source.clone();
    rotateGeometryAroundZ(geo, rotationZDeg);
    const mesh = finalizePartPlacement(geo);
    createFaceColorAttribute(mesh.geometry);
    setProcessedMesh(mesh);
    setMeshKey((k) => k + 1);
  }, []);

  const commitOrientationSource = useCallback((geometry: THREE.BufferGeometry) => {
    sourceGeometryRef.current = geometry.clone();
  }, []);

  useEffect(() => {
    registerPartTransformBridge({
      applyRotationZ: applyOrientation,
      commitOrientationSource,
    });
    return () => registerPartTransformBridge(null);
  }, [applyOrientation, commitOrientationSource]);

  useEffect(() => {
    if (!stlUrl) {
      setProcessedMesh(null);
      setLoadError(null);
      setLoading(false);
      sourceGeometryRef.current = null;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setProcessedMesh(null);
    sourceGeometryRef.current = null;

    loadStlGeometry(stlUrl)
      .then((rawGeometry) => {
        if (cancelled) return;
        const mesh = processStlGeometry(rawGeometry);
        sourceGeometryRef.current = mesh.geometry.clone();
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
  }, [processedMesh, meshKey, setPartBounds]);

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
    commitOrientationSource,
  };
}
