import { ref, computed, reactive, nextTick, watch } from 'vue'
import { dbGet, dbPut, dbDelMany } from '../db.js'
import { t } from '../i18n.js'
import { pushCanvasUpdate, pushActiveLayer, myIdentity } from '../collabSync.js'
import { isSyncActive } from '../widgetContext.js'

export function useLayers({ paintStore, onCancelDraw, getFloatOverlay }) {
  let layerIdSeq = 0

  const canvasRef      = ref(null)
  const thumbRefs      = reactive({})
  const canvasLogicalW = ref(1080)
  const canvasLogicalH = ref(1920)
  const canvasSize     = ref({ w: 1080, h: 1920 })
  const layers         = ref([])
  const activeLayerId  = ref(null)
  const editingId      = ref(null)
  const isPanelOpen    = ref(true)
  const history        = ref([])
  const historyIndex   = ref(-1)

  // Lets peers show an avatar badge on whichever layer this participant is
  // currently working on (see App.vue's presence panel).
  if (isSyncActive) watch(activeLayerId, id => pushActiveLayer(id))

  const activeIndex     = computed(() => layers.value.findIndex(l => l.id === activeLayerId.value))
  const activeLayer     = computed(() => layers.value[activeIndex.value] ?? null)
  const displayedLayers = computed(() => [...layers.value].reverse())

  function createLayerCanvas(w, h) {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    return c
  }

  function makeLayer(name, w, h) {
    return { id: ++layerIdSeq, name, visible: true, opacity: 100, canvas: createLayerCanvas(w, h) }
  }

  function composite() {
    const display = canvasRef.value
    if (!display) return
    const ctx = display.getContext('2d')
    const w = display.width, h = display.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    for (const layer of layers.value) {
      if (!layer.visible || !layer.canvas) continue
      ctx.globalAlpha = layer.opacity / 100
      ctx.drawImage(layer.canvas, 0, 0)
      // float 懸浮內容插在 active layer 之後（同 opacity），保持正確的 z 順序
      if (getFloatOverlay && layer.id === activeLayerId.value) {
        const fl = getFloatOverlay()
        if (fl) ctx.drawImage(fl.canvas, fl.x, fl.y)
      }
      ctx.globalAlpha = 1
    }
    ctx.globalAlpha = 1
    updateThumbs()
  }

  function updateThumbs() {
    nextTick(() => {
      for (const layer of layers.value) {
        const thumb = thumbRefs[layer.id]
        if (!thumb || !layer.canvas) continue
        const tctx = thumb.getContext('2d')
        const tw = thumb.width, th = thumb.height
        for (let y = 0; y < th; y += 5)
          for (let x = 0; x < tw; x += 5) {
            tctx.fillStyle = (((x / 5) + (y / 5)) % 2 === 0) ? '#cccccc' : '#eeeeee'
            tctx.fillRect(x, y, 5, 5)
          }
        tctx.drawImage(layer.canvas, 0, 0, tw, th)
      }
    })
  }

  let _persistTimer = null

  function schedulePersist() {
    clearTimeout(_persistTimer)
    _persistTimer = setTimeout(persistToStorage, 600)
  }

  // Guards against echoing a just-received remote update straight back out
  // to the sync server (see applyRemoteLayers below).
  let _applyingRemote = false
  // Snapshot of what was last successfully pushed to the sync service, keyed
  // by layer id — used to diff out only the layers that actually changed so
  // an edit to one layer never overwrites another peer's concurrent edit to
  // a different layer. See atelier-sync/server.js for the matching
  // per-layer, rev-guarded merge on the receiving end.
  const _lastSynced = new Map() // id -> { name, visible, opacity, dataURL }

  function _layerDiffers(l, dataURL) {
    const prev = _lastSynced.get(l.id)
    if (!prev) return true
    return prev.dataURL !== dataURL || prev.name !== l.name ||
      prev.visible !== l.visible || prev.opacity !== l.opacity
  }

  // Saves current layer state to local IndexedDB/paintStore only — no
  // network involvement, no _lastSynced bookkeeping. Safe to call from any
  // context (local edit or after merging a remote update) without side
  // effects on what's considered "already pushed".
  async function persistLocalOnly() {
    const meta    = layers.value.map(l => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity }))
    const oldIds  = paintStore.layersMeta.map(m => `layer-${m.id}`)
    const newIds  = new Set(meta.map(m => `layer-${m.id}`))
    const toDelete = oldIds.filter(k => !newIds.has(k))

    paintStore.layersMeta    = meta
    paintStore.activeLayerId = activeLayerId.value
    paintStore.canvasW       = canvasLogicalW.value
    paintStore.canvasH       = canvasLogicalH.value
    paintStore.layerIdSeq    = layerIdSeq

    await dbDelMany(toDelete)
    const dataURLs = await Promise.all(layers.value.map(l => Promise.resolve(l.canvas.toDataURL())))
    await Promise.all(layers.value.map((l, i) => dbPut(`layer-${l.id}`, dataURLs[i])))
    return dataURLs
  }

  // Diffs current layer state against _lastSynced and pushes only what
  // changed since the last push, then stamps _lastSynced to match.
  //
  // Must only run for a genuinely local edit. If this ran as a side effect
  // of applyRemoteLayers(), _lastSynced would get stamped for EVERY layer
  // currently in layers.value — including one the local user just finished
  // drawing on but whose own debounced persistToStorage() hasn't fired yet.
  // That layer would then look "already synced" and its real push would be
  // silently dropped when its timer finally runs, i.e. the local user's own
  // completed stroke never reaches the server and appears to get reverted
  // once a peer's unrelated update comes in. Keep this split from
  // applyRemoteLayers, which calls persistLocalOnly() directly instead.
  function pushChangesToSync(dataURLs) {
    if (!isSyncActive) return
    if (_applyingRemote) {
      console.log(`[sync:${myIdentity.name}] pushChangesToSync SKIPPED — a remote merge is still in flight (_applyingRemote=true)`)
      return
    }
    const currentIds = new Set(layers.value.map(l => l.id))
    const removedLayerIds = Array.from(_lastSynced.keys()).filter(id => !currentIds.has(id))
    const changed = layers.value
      .map((l, i) => ({ l, dataURL: dataURLs[i] }))
      .filter(({ l, dataURL }) => _layerDiffers(l, dataURL))
      .map(({ l, dataURL }) => ({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        dataURL, rev: Date.now(),
      }))

    console.log(`[sync:${myIdentity.name}] pushChangesToSync: layers=${layers.value.map(l=>l.id)} changed=${changed.map(c=>c.id)} removed=${removedLayerIds}`)

    if (changed.length || removedLayerIds.length) {
      pushCanvasUpdate({
        canvasW: canvasLogicalW.value,
        canvasH: canvasLogicalH.value,
        layerOrder: layers.value.map(l => l.id),
        layers: changed,
        removedLayerIds,
      })
    }

    for (const id of removedLayerIds) _lastSynced.delete(id)
    layers.value.forEach((l, i) => _lastSynced.set(l.id, {
      name: l.name, visible: l.visible, opacity: l.opacity, dataURL: dataURLs[i],
    }))
  }

  async function persistToStorage() {
    const dataURLs = await persistLocalOnly()
    pushChangesToSync(dataURLs)
  }

  // Merges a partial layer update received from a peer via the sync
  // service. Only touches the layers actually present in the payload —
  // everything else in local state is left alone. Bypasses saveHistory()
  // (remote changes don't pollute local undo) but still persists locally so
  // a refresh doesn't lose the synced state.
  async function applyRemoteLayers(payload) {
    if (!payload || !canvasRef.value) return
    _applyingRemote = true
    console.log(`[sync:${myIdentity.name}] applyRemoteLayers START — before=${layers.value.map(l=>l.id)} incoming=${(payload.layers||[]).map(l=>l.id)} order=${payload.layerOrder} localCanvas=${canvasLogicalW.value}x${canvasLogicalH.value} incomingCanvas=${payload.canvasW}x${payload.canvasH}`)
    try {
      const w = payload.canvasW || canvasLogicalW.value
      const h = payload.canvasH || canvasLogicalH.value
      if (w !== canvasLogicalW.value || h !== canvasLogicalH.value) {
        console.log(`[sync:${myIdentity.name}] applyRemoteLayers: canvas size mismatch, resizing all layers ${canvasLogicalW.value}x${canvasLogicalH.value} -> ${w}x${h}`)
        canvasLogicalW.value   = w
        canvasLogicalH.value   = h
        canvasRef.value.width  = w
        canvasRef.value.height = h
        canvasSize.value = { w, h }
        // Assigning canvas.width/height clears the bitmap even when only
        // one dimension actually changes. If this client's local canvas
        // size had drifted from the sender's (e.g. stale size persisted
        // from an earlier local session), every layer would be wiped here
        // — including ones this payload never mentions and so never
        // redraws — silently blanking otherwise-untouched layers. Preserve
        // each layer's existing pixels across the resize.
        for (const layer of layers.value) {
          const c = layer.canvas
          let snapshot = null
          if (c.width && c.height) {
            try { snapshot = c.getContext('2d').getImageData(0, 0, c.width, c.height) } catch { /* ignore */ }
          }
          c.width = w
          c.height = h
          if (snapshot) c.getContext('2d').putImageData(snapshot, 0, 0)
        }
      }

      const byId = new Map(layers.value.map(l => [l.id, l]))

      for (const incoming of payload.layers || []) {
        const existing = byId.get(incoming.id)
        if (existing) {
          existing.name    = incoming.name
          existing.visible = incoming.visible
          existing.opacity = incoming.opacity
          if (incoming.dataURL) {
            await new Promise(resolve => {
              const img = new Image()
              img.onload  = () => {
                // A local drawing tool (soft brush, eraser, ...) may have left
                // this context's globalAlpha/compositeOperation in a non-default
                // state. Reset both before drawing so the incoming layer content
                // replaces the canvas at full, normal-blend opacity — otherwise
                // a sync arriving mid-stroke fades the whole layer, not just
                // whatever's new.
                const ctx = existing.canvas.getContext('2d')
                ctx.globalAlpha = 1
                ctx.globalCompositeOperation = 'source-over'
                ctx.clearRect(0, 0, w, h)
                ctx.drawImage(img, 0, 0)
                resolve()
              }
              img.onerror = resolve
              img.src = incoming.dataURL
            })
          }
        } else {
          const canvas = createLayerCanvas(w, h)
          if (incoming.dataURL) {
            await new Promise(resolve => {
              const img = new Image()
              img.onload  = () => {
                const ctx = canvas.getContext('2d')
                ctx.globalAlpha = 1
                ctx.globalCompositeOperation = 'source-over'
                ctx.drawImage(img, 0, 0)
                resolve()
              }
              img.onerror = resolve
              img.src = incoming.dataURL
            })
          }
          const layer = { id: incoming.id, name: incoming.name, visible: incoming.visible, opacity: incoming.opacity, canvas }
          byId.set(incoming.id, layer)
          layerIdSeq = Math.max(layerIdSeq, incoming.id)
        }
      }

      for (const id of payload.removedLayerIds || []) byId.delete(id)

      // Reorder according to the authoritative layerOrder, keeping any
      // locally-known layer that hasn't appeared in an order list yet
      // (e.g. one we just created and haven't synced back out) at the end.
      const order = payload.layerOrder || Array.from(byId.keys())
      const ordered = order.filter(id => byId.has(id)).map(id => byId.get(id))
      for (const [id, layer] of byId) if (!order.includes(id)) ordered.push(layer)

      layers.value = ordered
      if (!ordered.find(l => l.id === activeLayerId.value))
        activeLayerId.value = ordered.at(-1)?.id ?? null

      console.log(`[sync:${myIdentity.name}] applyRemoteLayers MERGED — after=${layers.value.map(l=>l.id)}`)

      composite()
      const dataURLs = await persistLocalOnly()

      // Only the layers we just received are now known-synced. Anything
      // else in local state (e.g. a stroke the local user just finished
      // but whose own debounced persistToStorage() hasn't run yet) must be
      // left untouched here — see pushChangesToSync() above for why.
      //
      // Stamp using THIS canvas's own freshly re-encoded output (from
      // persistLocalOnly's toDataURL() pass), not the sender's raw dataURL
      // string. Decoding a PNG and redrawing it via drawImage(), then
      // re-encoding, isn't guaranteed to produce byte-identical output even
      // for pixel-identical content (alpha-blend rounding on semi-
      // transparent brush strokes is enough to shift it) — so comparing a
      // future local toDataURL() against the sender's original string would
      // make pushChangesToSync() see a false "change" on content that never
      // actually changed locally, and immediately re-push it. Both peers
      // doing that at once is an unbounded echo loop, and whichever stale
      // echo happens to land last can overwrite a real concurrent edit
      // despite carrying no new content (see the SEND/RECV ping-pong in the
      // debug log this was diagnosed from).
      for (const incoming of payload.layers || []) {
        const idx = layers.value.findIndex(x => x.id === incoming.id)
        if (idx !== -1) {
          const l = layers.value[idx]
          _lastSynced.set(incoming.id, {
            name: l.name, visible: l.visible, opacity: l.opacity, dataURL: dataURLs[idx],
          })
        }
      }
      for (const id of payload.removedLayerIds || []) _lastSynced.delete(id)
      console.log(`[sync:${myIdentity.name}] applyRemoteLayers DONE`)
    } finally {
      _applyingRemote = false
    }
  }

  function saveHistory() {
    if (!canvasRef.value) return
    const entry = {
      activeId: activeLayerId.value,
      states: layers.value.map(l => ({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        dataURL: l.canvas.toDataURL()
      }))
    }
    history.value = history.value.slice(0, historyIndex.value + 1)
    history.value.push(entry)
    if (history.value.length > 15) history.value.shift()
    historyIndex.value = history.value.length - 1
    schedulePersist()
  }

  async function applyHistoryEntry(entry) {
    onCancelDraw?.()
    const w = canvasRef.value.width, h = canvasRef.value.height

    const newLayers = await Promise.all(entry.states.map(s =>
      new Promise(resolve => {
        const canvas = createLayerCanvas(w, h)
        const img = new Image()
        img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0); resolve({ ...s, canvas }) }
        img.src = s.dataURL
      })
    ))

    layers.value = newLayers
    activeLayerId.value = entry.activeId
    if (!newLayers.find(l => l.id === activeLayerId.value) && newLayers.length)
      activeLayerId.value = newLayers[newLayers.length - 1].id

    composite()
  }

  async function undo() {
    if (historyIndex.value <= 0) return
    historyIndex.value--
    await applyHistoryEntry(history.value[historyIndex.value])
    schedulePersist()
  }

  async function redo() {
    if (historyIndex.value >= history.value.length - 1) return
    historyIndex.value++
    await applyHistoryEntry(history.value[historyIndex.value])
    schedulePersist()
  }

  function addLayer() {
    const w = canvasRef.value?.width || 800
    const h = canvasRef.value?.height || 600
    const layer = makeLayer(`${t('layerDefault')} ${layers.value.length + 1}`, w, h)
    layers.value.push(layer)
    activeLayerId.value = layer.id
    composite()
    saveHistory()
  }

  function duplicateLayer() {
    const src = activeLayer.value
    if (!src) return
    const w = src.canvas.width, h = src.canvas.height
    const layer = makeLayer(src.name + t('layerCopySuffix'), w, h)
    layer.visible = src.visible
    layer.opacity = src.opacity
    layer.canvas.getContext('2d').drawImage(src.canvas, 0, 0)
    layers.value.splice(activeIndex.value + 1, 0, layer)
    activeLayerId.value = layer.id
    composite()
    saveHistory()
  }

  function deleteActiveLayer() {
    if (layers.value.length <= 1) return
    const idx = activeIndex.value
    layers.value.splice(idx, 1)
    activeLayerId.value = layers.value[Math.min(idx, layers.value.length - 1)].id
    composite()
    saveHistory()
  }

  function toggleVisible(layer) {
    layer.visible = !layer.visible
    composite()
  }

  function moveUp() {
    const i = activeIndex.value
    if (i >= layers.value.length - 1) return
    const arr = layers.value;
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
    composite()
    saveHistory()
  }

  function moveDown() {
    const i = activeIndex.value
    if (i <= 0) return
    const arr = layers.value;
    [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]
    composite()
    saveHistory()
  }

  function mergeDown() {
    const i = activeIndex.value
    if (i <= 0) return
    const top = layers.value[i]
    const bot = layers.value[i - 1]
    const ctx = bot.canvas.getContext('2d')
    ctx.globalAlpha = top.opacity / 100
    ctx.drawImage(top.canvas, 0, 0)
    ctx.globalAlpha = 1
    layers.value.splice(i, 1)
    activeLayerId.value = bot.id
    composite()
    saveHistory()
  }

  function mergeAll() {
    if (layers.value.length <= 1) return
    const w = canvasRef.value.width, h = canvasRef.value.height
    const merged = makeLayer(t('layerMerged'), w, h)
    const ctx = merged.canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    for (const layer of layers.value) {
      if (!layer.visible) continue
      ctx.globalAlpha = layer.opacity / 100
      ctx.drawImage(layer.canvas, 0, 0)
    }
    ctx.globalAlpha = 1
    layers.value = [merged]
    activeLayerId.value = merged.id
    composite()
    saveHistory()
  }

  function clearLayer() {
    const layer = activeLayer.value
    if (!layer) return
    const ctx = layer.canvas.getContext('2d')
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    if (activeIndex.value === 0) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height)
    }
    composite()
    saveHistory()
  }

  function download() {
    const a = document.createElement('a')
    a.href = canvasRef.value.toDataURL('image/png')
    a.download = `atelier-${Date.now()}.png`
    a.click()
  }

  function doExport(format, quality) {
    const q   = quality / 100
    const w   = canvasLogicalW.value
    const h   = canvasLogicalH.value
    const tmp = document.createElement('canvas')
    tmp.width = w; tmp.height = h
    const ctx = tmp.getContext('2d')
    if (format !== 'png-alpha') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h) }
    for (const layer of layers.value) {
      if (!layer.visible || !layer.canvas) continue
      ctx.globalAlpha = layer.opacity / 100
      ctx.drawImage(layer.canvas, 0, 0)
    }
    ctx.globalAlpha = 1
    const mime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
    const ext  = format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : 'png'
    const data = (format === 'jpg' || format === 'webp') ? tmp.toDataURL(mime, q) : tmp.toDataURL(mime)
    const a = document.createElement('a')
    a.href = data; a.download = `atelier-${Date.now()}.${ext}`; a.click()
  }

  function importImageLayer(img, name) {
    const w = canvasLogicalW.value
    const h = canvasLogicalH.value
    const layer = makeLayer(name, w, h)
    const ctx = layer.canvas.getContext('2d')
    const scale = Math.min(w / img.width, h / img.height, 1)
    ctx.drawImage(img, (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale)
    layers.value.push(layer)
    activeLayerId.value = layer.id
    composite()
    saveHistory()
  }

  function getThumbnailBlob() {
    return new Promise(resolve => {
      const OG_W = 1200, OG_H = 630
      const tmp = document.createElement('canvas')
      tmp.width = OG_W; tmp.height = OG_H
      const ctx = tmp.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, OG_W, OG_H)
      const src = canvasRef.value
      if (src) {
        const scale = Math.min(OG_W / src.width, OG_H / src.height)
        const dw = src.width * scale, dh = src.height * scale
        ctx.drawImage(src, (OG_W - dw) / 2, (OG_H - dh) / 2, dw, dh)
      }
      tmp.toBlob(b => resolve(b), 'image/jpeg', 0.85)
    })
  }

  function getProjectData(canvasBg, userPalette) {
    const project = {
      version: 1,
      canvasW: canvasLogicalW.value,
      canvasH: canvasLogicalH.value,
      layerIdSeq,
      activeLayerId: activeLayerId.value,
      canvasBg,
      userPalette: [...userPalette],
      layers: layers.value.map(l => ({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        dataURL: l.canvas.toDataURL()
      }))
    }
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' })
    return { blob, filename: `atelier-${Date.now()}.atelier` }
  }

  function exportProject(canvasBg, userPalette) {
    const { blob, filename } = getProjectData(canvasBg, userPalette)
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  async function loadProject(project) {
    if (!project.layers || !project.canvasW || !project.canvasH) return null

    const w = project.canvasW, h = project.canvasH
    canvasLogicalW.value   = w
    canvasLogicalH.value   = h
    canvasRef.value.width  = w
    canvasRef.value.height = h
    canvasSize.value = { w, h }

    layerIdSeq = project.layerIdSeq ?? Math.max(0, ...project.layers.map(l => l.id))

    const restored = await Promise.all(
      project.layers.map(meta => new Promise(resolve => {
        const canvas = createLayerCanvas(w, h)
        if (!meta.dataURL) { resolve({ id: meta.id, name: meta.name, visible: meta.visible, opacity: meta.opacity, canvas }); return }
        const img = new Image()
        img.onload  = () => { canvas.getContext('2d').drawImage(img, 0, 0); resolve({ id: meta.id, name: meta.name, visible: meta.visible, opacity: meta.opacity, canvas }) }
        img.onerror = () => resolve({ id: meta.id, name: meta.name, visible: meta.visible, opacity: meta.opacity, canvas })
        img.src = meta.dataURL
      }))
    )

    layers.value = restored
    activeLayerId.value = project.activeLayerId
    if (!restored.find(l => l.id === activeLayerId.value) && restored.length)
      activeLayerId.value = restored.at(-1).id

    composite()
    saveHistory()

    return { canvasBg: project.canvasBg, userPalette: project.userPalette }
  }

  function resetToBlank() {
    const w = canvasLogicalW.value, h = canvasLogicalH.value
    layerIdSeq = 0
    const bg    = makeLayer(t('layerBg'), w, h)
    const bgCtx = bg.canvas.getContext('2d')
    bgCtx.fillStyle = '#ffffff'; bgCtx.fillRect(0, 0, w, h)
    canvasRef.value.width  = w; canvasRef.value.height = h
    layers.value = [bg]
    activeLayerId.value = bg.id
    history.value = []; historyIndex.value = -1
    composite(); saveHistory()
  }

  function resizeCanvasTo(w, h) {
    return new Promise(resolve => {
      const saved = layers.value.map(l => ({ id: l.id, url: l.canvas.toDataURL() }))
      canvasRef.value.width  = w; canvasRef.value.height = h
      canvasLogicalW.value   = w; canvasLogicalH.value   = h
      canvasSize.value       = { w, h }
      for (const layer of layers.value) { layer.canvas.width = w; layer.canvas.height = h }
      if (!saved.length) { composite(); saveHistory(); resolve(); return }
      let pending = saved.length
      for (const { id, url } of saved) {
        const layer = layers.value.find(l => l.id === id)
        if (!layer) { if (!--pending) { composite(); saveHistory(); resolve() }; continue }
        const img = new Image()
        img.onload = () => {
          layer.canvas.getContext('2d').drawImage(img, 0, 0)
          if (!--pending) { composite(); saveHistory(); resolve() }
        }
        img.src = url
      }
    })
  }

  async function init() {
    isPanelOpen.value = false

    const w = paintStore.canvasW
    const h = paintStore.canvasH
    canvasLogicalW.value   = w
    canvasLogicalH.value   = h
    canvasRef.value.width  = w
    canvasRef.value.height = h
    canvasSize.value = { w, h }

    if (paintStore.layersMeta.length > 0) {
      layerIdSeq = paintStore.layerIdSeq

      const restored = await Promise.all(
        paintStore.layersMeta.map(async meta => {
          const canvas = createLayerCanvas(w, h)
          const dataURL = await dbGet(`layer-${meta.id}`)
          if (dataURL) {
            await new Promise(res => {
              const img = new Image()
              img.onload  = () => { canvas.getContext('2d').drawImage(img, 0, 0); res() }
              img.onerror = res
              img.src = dataURL
            })
          }
          return { id: meta.id, name: meta.name, visible: meta.visible, opacity: meta.opacity, canvas }
        })
      )

      layers.value = restored
      activeLayerId.value = paintStore.activeLayerId
      if (!layers.value.find(l => l.id === activeLayerId.value))
        activeLayerId.value = layers.value.at(-1)?.id ?? null
    } else {
      const bg    = makeLayer(t('layerBg'), w, h)
      const bgCtx = bg.canvas.getContext('2d')
      bgCtx.fillStyle = '#ffffff'; bgCtx.fillRect(0, 0, w, h)
      layers.value = [bg]
      activeLayerId.value = bg.id
    }

    composite()
    saveHistory()
  }

  return {
    canvasRef, thumbRefs,
    canvasLogicalW, canvasLogicalH, canvasSize,
    layers, activeLayerId, editingId, isPanelOpen,
    activeIndex, activeLayer, displayedLayers,
    history, historyIndex,
    composite, saveHistory, undo, redo,
    addLayer, duplicateLayer, deleteActiveLayer,
    toggleVisible, moveUp, moveDown, mergeDown, mergeAll, clearLayer,
    download, doExport, importImageLayer, getThumbnailBlob, getProjectData, exportProject, loadProject,
    resetToBlank, resizeCanvasTo, init, applyRemoteLayers,
  }
}
