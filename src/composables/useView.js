import { ref, reactive, computed } from 'vue'

export function useView(canvasLogicalW, canvasLogicalH) {
  const viewX    = ref(0)
  const viewY    = ref(0)
  const viewR    = ref(0)
  const viewZoom = ref(1.0)
  const areaSize = reactive({ w: 0, h: 0 })

  const fitScale = computed(() => {
    if (!areaSize.w || !areaSize.h) return 1
    return Math.min(areaSize.w / canvasLogicalW.value, areaSize.h / canvasLogicalH.value) * 0.92 * viewZoom.value
  })

  const vpStyle = computed(() => ({
    width:  canvasLogicalW.value + 'px',
    height: canvasLogicalH.value + 'px',
    marginLeft: -(canvasLogicalW.value / 2) + 'px',
    marginTop:  -(canvasLogicalH.value / 2) + 'px',
    transform: `translate(${viewX.value}px, ${viewY.value}px) rotate(${viewR.value}deg) scale(${fitScale.value})`,
  }))

  function resetView() { viewX.value = 0; viewY.value = 0; viewR.value = 0; viewZoom.value = 1.0 }
  function zoomIn()   { viewZoom.value = Math.min(8,    +(viewZoom.value * 1.25).toFixed(4)) }
  function zoomOut()  { viewZoom.value = Math.max(0.05, +(viewZoom.value / 1.25).toFixed(4)) }

  function resizeCanvas(wrapperEl) {
    if (!wrapperEl) return
    areaSize.w = wrapperEl.clientWidth
    areaSize.h = wrapperEl.clientHeight
  }

  return { viewX, viewY, viewR, viewZoom, areaSize, fitScale, vpStyle, resetView, zoomIn, zoomOut, resizeCanvas }
}
