# Easy CAM

A progressive web app for CNC router CAM — upload STL files, configure machining operations, visualize toolpaths, and export G-code.

## Features

- **STL Viewer** — Upload and view 3D models with orbit controls
- **Operation Palette** — Outline, Adaptive Outline, Drill, Helix, Pocket, and Contour operations
- **Operation Configuration** — Tool diameter, feed rate, plunge rate, step down, stepover, spindle speed, clearance, and cut depth
- **Geometry Selection** — Click faces on the STL model to assign geometry to each operation
- **Toolpath Visualization** — Color-coded toolpaths in the 3D viewer with per-operation visibility toggle
- **Drag-and-Drop Reordering** — Reorder operations in the machining sequence
- **Enable/Disable** — Toggle operations for G-code generation independently of visibility
- **Collapsible Cards** — Each operation collapses to a compact header with controls
- **G-code Export** — Generate and download `.nc` files from enabled operations
- **PWA** — Installable as a standalone app with offline support

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Build

```bash
npm run build
npm run preview
```

## Deploy to GitHub Pages

Public demo URL: **https://luhill.github.io/easy_cam/**

Publishing uses **GitHub Actions**, not “Deploy from a branch”:

1. **Settings → Pages → Build and deployment**
2. Set **Source** to **GitHub Actions**
3. **Actions → Deploy GitHub Pages → Run workflow** (or re-run a failed job)

Pushes to `main` deploy automatically after that.

```bash
npm run build:pages   # production build with /easy_cam/ base path
```

## Tech Stack

- React 19 + TypeScript
- Vite + vite-plugin-pwa
- Three.js / React Three Fiber / Drei
- Zustand (state management)
- dnd-kit (drag and drop)

## Usage

1. Upload an STL file
2. Add operations from the palette
3. Configure tool settings for each operation
4. Click **Select from Model** to pick geometry faces
5. Toggle visibility (eye) and enable/disable (bolt) per operation
6. Drag operations to reorder
7. Click **Export G-code** to download the machining program

## Future Features

1. Implement pocket / adaptive pocket.
2. Implement Contour
3. Load stl via drag and drop
4. Drill operation needs:
   1. Depth adjust
   2. Chip clearing
5. Multiple finish passes for outline (chip clear pass b4 final pass) 
## Bugs

1. Outline operation should only use adjusted feedrate for adaptive and final outline cuts.
2. Outline operation should ease into final pass
3. Aluminium feedrate adjustments (broken bits)
4. Loading new part should reset origin.
