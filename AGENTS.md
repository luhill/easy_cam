# AGENTS.md

## Cursor Cloud specific instructions

Easy CAM is a **frontend-only** single-page PWA (Vite 6 + React 19 + TypeScript, Three.js / React Three Fiber, Zustand). There is no backend, database, or server-side component, and there are currently no automated tests or lint script.

### Services & commands
- Single service: the Vite dev server. Standard scripts are in `package.json` / `README.md`.
  - `npm run dev` — dev server at `http://localhost:5173` (binds localhost only; pass `-- --host` if external access is needed).
  - `npm run build` — runs `tsc -b && vite build`. This is also the de-facto type check / lint gate (no separate `lint` or `test` script exists).
  - `npm run preview` — serves the production build.
- Node 22 is used in this environment (matches Vite 6 / React 19 requirements).

### Gotchas
- The application code lives on the PR branch (e.g. `cursor/cnc-pwa-stl-viewer-46f1`), not on `main`; `main` currently only contains `README.md`. Branch off the branch that actually has the app when developing features.
- Manual UI testing flow: click **Upload STL** (only `.stl` files are accepted), then add an operation from the **Operations** palette (palette buttons are disabled until an STL is loaded), then **Export G-code** downloads `program.nc`. A sample cube STL can be generated locally for testing.
