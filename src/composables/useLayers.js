import { ref, computed, reactive, nextTick } from 'vue'
import { dbGet, dbPut, dbDelMany } from '../db.js'
import { t } from '../i18n.js'

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

  async function persistToStorage() {
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
    await Promise.all(layers.value.map(l => dbPut(`layer-${l.id}`, l.canvas.toDataURL())))
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
    resetToBlank, resizeCanvasTo, init,
  }
}
