import * as THREE from 'three';

export const FACE_COLORS = {
  base: new THREE.Color('#6b7a8d'),
  hover: new THREE.Color('#93c5fd'),
  hoverBottom: new THREE.Color('#f59e0b'),
  hoverSelected: new THREE.Color('#fbbf24'),
  selected: new THREE.Color('#3b82f6'),
};

const STATE_BASE = 0;
const STATE_HOVER = 1;
const STATE_SELECTED = 2;
const STATE_HOVER_SELECTED = 3;

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

function colorForState(
  state: number,
  selectedColor: THREE.Color,
  hoverColor: THREE.Color = FACE_COLORS.hover
): THREE.Color {
  switch (state) {
    case STATE_HOVER:
      return hoverColor;
    case STATE_SELECTED:
      return selectedColor;
    case STATE_HOVER_SELECTED:
      return FACE_COLORS.hoverSelected;
    default:
      return FACE_COLORS.base;
  }
}

function resolveState(faceIndex: number, selected: ReadonlySet<number>, hovered: ReadonlySet<number>): number {
  const isSelected = selected.has(faceIndex);
  const isHovered = hovered.has(faceIndex);
  if (isSelected && isHovered) return STATE_HOVER_SELECTED;
  if (isSelected) return STATE_SELECTED;
  if (isHovered) return STATE_HOVER;
  return STATE_BASE;
}

/** Incrementally updates vertex colors — only repaints faces whose state changed. */
export class FaceColorManager {
  private readonly colors: Float32Array;
  private readonly faceCount: number;
  private readonly displayState: Uint8Array;

  constructor(colors: Float32Array, faceCount: number) {
    this.colors = colors;
    this.faceCount = faceCount;
    this.displayState = new Uint8Array(faceCount);
  }

  syncAll(
    selected: ReadonlySet<number>,
    hovered: ReadonlySet<number>,
    selectedColor: THREE.Color = FACE_COLORS.selected,
    hoverColor: THREE.Color = FACE_COLORS.hover
  ): void {
    for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
      this.applyState(
        faceIndex,
        resolveState(faceIndex, selected, hovered),
        selectedColor,
        hoverColor
      );
    }
  }

  /** Update only faces in the symmetric diff of two regions (hover change). */
  updateHoverRegion(
    prevFaces: readonly number[],
    nextFaces: readonly number[],
    selected: ReadonlySet<number>,
    selectedColor: THREE.Color = FACE_COLORS.selected,
    hoverColor: THREE.Color = FACE_COLORS.hover
  ): void {
    const nextSet = new Set(nextFaces);

    for (const face of prevFaces) {
      if (!nextSet.has(face)) {
        this.applyState(face, selected.has(face) ? STATE_SELECTED : STATE_BASE, selectedColor, hoverColor);
      }
    }

    for (const face of nextFaces) {
      this.applyState(
        face,
        selected.has(face) ? STATE_HOVER_SELECTED : STATE_HOVER,
        selectedColor,
        hoverColor
      );
    }
  }

  /** Update only faces added or removed from selection. */
  updateSelectionDiff(
    prevSelected: ReadonlySet<number>,
    nextSelected: ReadonlySet<number>,
    hovered: ReadonlySet<number>,
    selectedColor: THREE.Color = FACE_COLORS.selected,
    hoverColor: THREE.Color = FACE_COLORS.hover
  ): void {
    for (const face of prevSelected) {
      if (!nextSelected.has(face)) {
        this.applyState(face, hovered.has(face) ? STATE_HOVER : STATE_BASE, selectedColor, hoverColor);
      }
    }
    for (const face of nextSelected) {
      if (!prevSelected.has(face)) {
        this.applyState(face, resolveState(face, nextSelected, hovered), selectedColor, hoverColor);
      }
    }
  }

  private applyState(
    faceIndex: number,
    state: number,
    selectedColor: THREE.Color,
    hoverColor: THREE.Color = FACE_COLORS.hover
  ): void {
    if (this.displayState[faceIndex] === state) return;
    this.displayState[faceIndex] = state;
    paintFace(this.colors, faceIndex, colorForState(state, selectedColor, hoverColor));
  }
}

export function hexToThreeColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
