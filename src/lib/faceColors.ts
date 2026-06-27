import * as THREE from 'three';

export const FACE_COLORS = {
  base: new THREE.Color('#6b7a8d'),
  hover: new THREE.Color('#93c5fd'),
  hoverSelected: new THREE.Color('#fbbf24'),
  selected: new THREE.Color('#3b82f6'),
};

export function getFaceCount(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  return position.count / 3;
}

export function createFaceColorAttribute(
  geometry: THREE.BufferGeometry
): THREE.BufferAttribute {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const faceCount = getFaceCount(geometry);

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    paintFace(colors, faceIndex, FACE_COLORS.base);
  }

  const attribute = new THREE.BufferAttribute(colors, 3);
  geometry.setAttribute('color', attribute);
  return attribute;
}

export function paintFace(
  colors: Float32Array,
  faceIndex: number,
  color: THREE.Color
): void {
  const offset = faceIndex * 9;
  for (let vertex = 0; vertex < 3; vertex++) {
    const i = offset + vertex * 3;
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
}

export function repaintFaceColors(
  colors: Float32Array,
  faceCount: number,
  selectedFaces: ReadonlySet<number>,
  hoveredFace: number | null,
  selectedColor: THREE.Color = FACE_COLORS.selected
): void {
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    if (selectedFaces.has(faceIndex)) {
      paintFace(
        colors,
        faceIndex,
        faceIndex === hoveredFace ? FACE_COLORS.hoverSelected : selectedColor
      );
    } else if (faceIndex === hoveredFace) {
      paintFace(colors, faceIndex, FACE_COLORS.hover);
    } else {
      paintFace(colors, faceIndex, FACE_COLORS.base);
    }
  }
}

export function hexToThreeColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
