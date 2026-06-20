# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # dev server bound to 0.0.0.0 (LAN-accessible at 192.168.0.111)
npm run build    # production build → ./dist/
npm run preview  # preview the production build locally
```

Deploy by copying `dist/` to the nginx web root and reloading nginx (see README for full steps).

## Architecture

This is a single-page painting app. Nearly all logic lives in `src/App.vue` (~2600 lines) — there are no child components or router.

### Canvas model

Every layer is an **off-screen `<canvas>` element** held in the `layers` reactive array. The visible `canvasRef` is a **composite canvas** that re-renders by iterating `layers` and drawing each layer's canvas with its opacity setting (`composite()`). All draw operations target the active layer's off-screen canvas, then call `composite()` to update the display.

Shape tools (line, rect, circle) work by saving a `layerSnapshot` (`ImageData`) on mousedown, restoring it on every mousemove, then drawing the preview on top — so the display reflects a live preview without accumulating intermediate states.

### Persistence split

Two separate mechanisms exist:

| What | Where | Module |
|------|-------|--------|
| UI state, user palette, active layer ID, canvas dimensions | `localStorage` via Pinia + `pinia-plugin-persistedstate` | `src/stores/paintStore.js` |
| Layer pixel data (as `dataURL` strings) | IndexedDB, database `paint-app`, object store `layers`, keyed `layer-{id}` | `src/db.js` |

Persistence is debounced 600 ms after any change (`schedulePersist → persistToStorage`). On mount, the store's `layersMeta` is used to re-inflate layer canvases from IndexedDB.

Undo/redo history (`history` ref, max 15 entries) is **in-memory only** — each entry is an array of `{ id, name, visible, opacity, dataURL }` snapshots. `saveHistory()` is called after every committed action and also triggers `schedulePersist()`.

### i18n

`src/i18n.js` is a minimal custom module — a reactive `locale` ref (backed by `localStorage`) and a `t(key)` function that reads from a flat `messages` object. Supported locales: `en`, `zh`. To add a key, add it to both locale objects in that file.

### Touch / pointer unification

Touch events are translated into synthetic mouse-like objects via `t2m(e)` and forwarded to the same `onPointerDown/Move/Up` handlers. Sticky-note and color-palette drag/resize use separate `window`-level `mousemove`/`mouseup` listeners.

### Keyboard shortcuts

Defined in `onKey` (App.vue): `P B L R C F I E H` switch tools; `Ctrl+Z/Y` undo/redo; `Ctrl+=/-` zoom; `Ctrl+0` reset view.
