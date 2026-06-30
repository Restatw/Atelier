# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # dev server bound to 0.0.0.0 (LAN-accessible at 192.168.0.111)
npm run build    # production build → ./dist/
npm run preview  # preview the production build locally
```

Deploy by copying `dist/` to the nginx web root and reloading nginx (see README for full steps). A Cloudflare Worker (`cloudflare-worker/`) handles OG preview pages for shared artwork links; deploy it separately via Wrangler.

## Architecture

Single-page painting app. Entry point: `src/main.js` → `src/App.vue` (~4300 lines). One child component (`src/FloatingPopup.vue`). No router.

### File map

| File | Purpose |
|------|---------|
| `src/App.vue` | Root component — tool dispatch, drawing, selection, text, UI wiring |
| `src/FloatingPopup.vue` | Draggable, resizable, minimizable popup window used by all tool panels |
| `src/stores/paintStore.js` | Pinia store — UI state persisted to `localStorage` |
| `src/db.js` | IndexedDB helpers (`dbGet`, `dbPut`, `dbDelMany`) for layer pixel data |
| `src/i18n.js` | Minimal i18n — reactive `locale` ref + `t(key)`, locales: `en`, `zh` |
| `src/ipfs.js` | IPFS upload (`uploadToIPFS`) and URL helpers; supports Pinata and local node |
| `src/composables/useLayers.js` | Layer CRUD, undo/redo, persistence scheduling, composite render |
| `src/composables/useView.js` | Pan / zoom / rotate viewport state and `vpStyle` computed |
| `src/composables/useColorWheel.js` | HSV color wheel canvas rendering and hex↔HSV conversion |
| `src/composables/useStickyNotes.js` | Sticky note state, drag/resize, z-order |
| `src/composables/useIpfsBackup.js` | IPFS backup/restore flow, status tracking |
| `cloudflare-worker/worker.js` | Serves static assets + generates OG meta page at `/og?cid=&thumb=` |

### Canvas model

Every layer is an **off-screen `<canvas>` element** held in the `layers` reactive array (managed by `useLayers`). The visible `canvasRef` is a **composite canvas** that re-renders by iterating `layers` and blending each with its opacity (`composite()`). Draw operations target the active layer's off-screen canvas, then call `composite()`.

Shape tools (line, rect, circle) use a `layerSnapshot` (`ImageData`) saved on mousedown, restored on every mousemove, then overdraw the preview — giving a live preview without accumulating intermediate states.

Two selection overlay canvases sit above the main canvas:
- `selMaskOverlayRef` — filled mask showing selected region
- `selBorderOverlayRef` — animated marching-ants border

A `selFloat` ImageData holds a floating selection while it is being moved.

Canvas dimensions can be resized interactively via drag handles on the right/bottom/corner edges (`startCanvasResize`).

### Tools

| Tool | Key | Notes |
|------|-----|-------|
| pen | P | Pressure-sensitive size via pointer pressure |
| brush | B | Soft round brush with opacity |
| line | L | Shape preview via snapshot |
| rect | R | Shape preview via snapshot |
| circle | C | Shape preview via snapshot |
| fill (bucket) | F | Flood fill with tolerance |
| eyedropper | I | Pick color from canvas |
| eraser | E | |
| sel_pen | W | Paint into selection mask |
| sel_eras | — | Erase from selection mask |
| select_rect | — | Rectangular marquee |
| lasso | — | Freehand lasso |
| magic_wand | — | Tolerance-based flood select |
| text | — | Draggable text overlay, commits to layer on Ctrl+Enter |
| move | — | Move active layer |
| pan | H | Pan viewport |
| rotate | — | Rotate viewport |

### Persistence split

| What | Where | Module |
|------|-------|--------|
| UI state, palette, active layer ID, canvas size, IPFS settings | `localStorage` via Pinia + `pinia-plugin-persistedstate` | `src/stores/paintStore.js` |
| Layer pixel data (`dataURL` strings) | IndexedDB `paint-app` / object store `layers` / key `layer-{id}` | `src/db.js` |

Persistence is debounced 600 ms after any change (`schedulePersist → persistToStorage`). On mount, `layersMeta` from the store re-inflates layer canvases from IndexedDB.

Undo/redo (`history` ref, max 15 entries) is **in-memory only** — each entry is `{ id, name, visible, opacity, dataURL }[]`. `saveHistory()` is called after every committed action.

### IPFS backup

`useIpfsBackup` serialises all layer pixel data + metadata into a JSON blob and uploads via `src/ipfs.js`. Supports **Pinata** (JWT) and **local IPFS node** (HTTP API). The last CID is stored in `localStorage`. The Cloudflare Worker generates an OG preview page from a `?cid=&thumb=` query so shared links render correctly on social media.

### FloatingPopup

`src/FloatingPopup.vue` is a generic draggable/resizable/minimizable container. All tool popups (color, brush, file, settings, wand, text, backup) use it. Z-order among open popups is managed by a shared `_popupZ` counter in `App.vue` (`bringXToFront` helpers).

### i18n

`src/i18n.js` — reactive `locale` ref (backed by `localStorage`), `t(key)` reads a flat `messages` object. Supported: `en`, `zh`. Add keys to both locale objects there.

### Touch / pointer unification

Touch events are translated into synthetic mouse-like objects via `t2m(e)` and forwarded to `onPointerDown/Move/Up`. Sticky-note and popup drag/resize use `window`-level `mousemove`/`mouseup` listeners.

### Keyboard shortcuts

Defined in `onKey` (App.vue): `P B L R C F I E H W` switch tools; `Ctrl+Z/Y` undo/redo; `Ctrl+=/-` zoom; `Ctrl+0` reset view.

### Build / PWA

Vite + `vite-plugin-pwa`. The PWA manifest is in `vite.config.js`. `__APP_VERSION__`, `__GITHUB_URL__`, and `__CHANGELOG__` (last 8 git commits) are injected as globals at build time.
