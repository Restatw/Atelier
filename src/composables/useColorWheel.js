import { ref, watch, nextTick } from 'vue'

export function useColorWheel({ activeColor, activeColorTarget, colorMode, colorPopupOpen, selectColor }) {
  const svCanvasRef = ref(null)
  const hsvH = ref(0)
  const hsvS = ref(100)
  const hsvV = ref(100)

  function hsvToHex(h, s, v) {
    s /= 100; v /= 100
    const k = n => (n + h / 60) % 6
    const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1))
    return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
  }

  function hexToHsv(hex) {
    const r = parseInt(hex.slice(1,3), 16) / 255
    const g = parseInt(hex.slice(3,5), 16) / 255
    const b = parseInt(hex.slice(5,7), 16) / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
    let h = 0
    if (d !== 0) {
      if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      else if (max === g) h = ((b - r) / d + 2) / 6
      else                h = ((r - g) / d + 4) / 6
    }
    return { h: Math.round(h * 360), s: Math.round(max === 0 ? 0 : d / max * 100), v: Math.round(max * 100) }
  }

  function drawSvCanvas() {
    const canvas = svCanvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width, h = canvas.height
    const gs = ctx.createLinearGradient(0, 0, w, 0)
    gs.addColorStop(0, '#ffffff')
    gs.addColorStop(1, `hsl(${hsvH.value},100%,50%)`)
    ctx.fillStyle = gs; ctx.fillRect(0, 0, w, h)
    const gv = ctx.createLinearGradient(0, 0, 0, h)
    gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = gv; ctx.fillRect(0, 0, w, h)
    const cx = (hsvS.value / 100) * w
    const cy = (1 - hsvV.value / 100) * h
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke()
  }

  let svDragging = false

  function svApply(e) {
    const canvas = svCanvasRef.value
    const rect = canvas.getBoundingClientRect()
    hsvS.value = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100)
    hsvV.value = Math.round(Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)) * 100)
    selectColor(hsvToHex(hsvH.value, hsvS.value, hsvV.value))
    drawSvCanvas()
  }

  function onSvDown(e)       { svDragging = true; svApply(e) }
  function onSvMove(e)       { if (svDragging) svApply(e) }
  function onSvUp()          { svDragging = false }
  function onSvTouchStart(e) { svDragging = true; svApply(e.touches[0]) }
  function onSvTouchMove(e)  { if (svDragging) svApply(e.touches[0]) }
  function onHueInput()      { selectColor(hsvToHex(hsvH.value, hsvS.value, hsvV.value)); drawSvCanvas() }

  function syncFromActiveColor() {
    const hsv = hexToHsv(activeColor.value)
    hsvH.value = hsv.h; hsvS.value = hsv.s; hsvV.value = hsv.v
    nextTick(drawSvCanvas)
  }

  watch(colorMode,         mode  => { if (mode === 'wheel') syncFromActiveColor() })
  watch(activeColorTarget, ()    => { if (colorMode.value === 'wheel') syncFromActiveColor() })
  watch(colorPopupOpen,    open  => { if (open && colorMode.value === 'wheel') syncFromActiveColor() })

  return { svCanvasRef, hsvH, hsvS, hsvV, onSvDown, onSvMove, onSvUp, onSvTouchStart, onSvTouchMove, onHueInput }
}
