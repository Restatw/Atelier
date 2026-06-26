<script setup>
import { ref, reactive, computed, watch, nextTick, onUnmounted } from 'vue'
import { X, Minimize2 } from 'lucide-vue-next'
import { t } from './i18n.js'

const props = defineProps({
  open:      { type: Boolean, required: true },
  title:     { type: String,  default: '' },
  zIndex:    { type: Number,  default: 9999 },
  width:     { type: Number,  default: null },
  resizable: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'update:width', 'bring-to-front'])

const minimized = ref(false)
const pos = reactive({ x: 100, y: 80 })
let _positioned = false
const popupEl = ref(null)

let _dragging = false, _dOx = 0, _dOy = 0, _dNx = 0, _dNy = 0, _dH = 0
let _resizing = false, _rOx = 0, _rNw = 0

function initPos(x, y) {
  if (!_positioned) { pos.x = x; pos.y = y; _positioned = true }
}
function reset() { _positioned = false }

watch(() => props.open && !minimized.value, async visible => {
  if (!visible) return
  await nextTick()
  if (!popupEl.value) return
  const pw = props.width ?? popupEl.value.offsetWidth
  const ph = popupEl.value.offsetHeight
  if (pos.y + ph > window.innerHeight - 6)
    pos.y = Math.max(6, window.innerHeight - ph - 6)
  if (pos.x + pw > window.innerWidth - 6)
    pos.x = Math.max(6, window.innerWidth - pw - 6)
})

function _addListeners() {
  window.addEventListener('mousemove', _onMove)
  window.addEventListener('mouseup',   _onUp)
  window.addEventListener('touchmove', _onTouchMove, { passive: false })
  window.addEventListener('touchend',  _onUp)
}
function _removeListeners() {
  window.removeEventListener('mousemove', _onMove)
  window.removeEventListener('mouseup',   _onUp)
  window.removeEventListener('touchmove', _onTouchMove)
  window.removeEventListener('touchend',  _onUp)
}

function startDrag(e) {
  emit('bring-to-front')
  _dragging = true
  _dOx = e.clientX; _dOy = e.clientY
  _dNx = pos.x;    _dNy = pos.y
  _dH  = popupEl.value?.offsetHeight ?? 44
  _addListeners()
}
function startDragTouch(e) { startDrag(e.touches[0]) }

function startResize(e) {
  emit('bring-to-front')
  _resizing = true
  _rOx = e.clientX
  _rNw = props.width ?? popupEl.value?.offsetWidth ?? 220
  _addListeners()
}
function startResizeTouch(e) { startResize(e.touches[0]) }

function _onMove(e) {
  if (_dragging) {
    const pw = props.width ?? popupEl.value?.offsetWidth ?? 220
    pos.x = Math.max(6, Math.min(_dNx + e.clientX - _dOx, window.innerWidth  - pw - 6))
    pos.y = Math.max(6, Math.min(_dNy + e.clientY - _dOy, window.innerHeight - _dH - 6))
  } else if (_resizing) {
    const nw = Math.max(180, Math.min(_rNw + e.clientX - _rOx, window.innerWidth - pos.x - 6))
    emit('update:width', nw)
  }
}
function _onTouchMove(e) {
  if (_dragging || _resizing) { e.preventDefault(); _onMove(e.touches[0]) }
}
function _onUp() {
  _dragging = false; _resizing = false
  _removeListeners()
}

onUnmounted(_removeListeners)

const floatStyle = computed(() => ({
  position: 'fixed', left: pos.x + 'px', top: pos.y + 'px', zIndex: props.zIndex,
}))
const popupStyle = computed(() => ({
  position: 'fixed', left: pos.x + 'px', top: pos.y + 'px', zIndex: props.zIndex,
  ...(props.width != null ? { width: props.width + 'px' } : {}),
}))

defineExpose({ initPos, reset, pos, minimized })
</script>

<template>
  <!-- Minimized float -->
  <div v-if="open && minimized" class="flp-float" :style="floatStyle"
    @mousedown.stop="startDrag" @touchstart.prevent.stop="startDragTouch" @contextmenu.prevent>
    <div class="flp-float-body" @click.stop="minimized = false" @touchstart.stop :title="t('expand')">
      <slot name="icon" />
    </div>
    <button class="flp-float-close" @click.stop="$emit('update:open', false)"
      @mousedown.stop @touchstart.stop :title="t('close')">
      <X :size="9" />
    </button>
  </div>

  <!-- Expanded popup -->
  <div v-if="open && !minimized" ref="popupEl" class="flp-popup" :style="popupStyle"
    @click.stop @mousedown.stop="emit('bring-to-front')" @contextmenu.prevent>
    <div class="flp-header" @mousedown.stop="startDrag" @touchstart.prevent.stop="startDragTouch">
      <span class="flp-title">{{ title }}</span>
      <div class="flp-hdr-btns">
        <button class="flp-hdr-btn" @click.stop="minimized = true"
          @mousedown.stop @touchstart.stop :title="t('minimize')">
          <Minimize2 :size="11" />
        </button>
        <button class="flp-hdr-btn flp-close-btn" @click.stop="$emit('update:open', false)"
          @mousedown.stop @touchstart.stop :title="t('close')">
          <X :size="11" />
        </button>
      </div>
    </div>
    <slot />
    <div v-if="resizable" class="flp-resize-handle"
      @mousedown.stop="startResize" @touchstart.prevent.stop="startResizeTouch" />
  </div>
</template>

<style>
.flp-float {
  user-select: none;
  cursor: grab;
  touch-action: manipulation;
}
.flp-float:active { cursor: grabbing; }
.flp-float-body {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: #111111;
  border: 1px solid #2a2a2a;
  box-shadow: 0 4px 16px rgba(0,0,0,0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #cccccc;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.flp-float-body:hover { border-color: #6060cc; box-shadow: 0 4px 20px rgba(0,0,0,0.8); }
.flp-float-close {
  position: absolute;
  top: -7px; right: -7px;
  width: 17px; height: 17px;
  border-radius: 50%;
  border: 1px solid #2a2a2a;
  background: #1a1a1a;
  color: #888888;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  z-index: 10;
  transition: background 0.12s, color 0.12s;
}
.flp-float-close:hover { background: rgba(200,50,50,0.7); color: #fff; border-color: transparent; }

.flp-popup {
  background: #111111;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 0 10px 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.7);
  user-select: none;
  touch-action: manipulation;
}
.flp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 2px 8px;
  cursor: grab;
  border-bottom: 1px solid #161616;
  margin-bottom: 8px;
}
.flp-header:active { cursor: grabbing; }
.flp-title {
  font-size: 12px;
  color: #888888;
  user-select: none;
}
.flp-hdr-btns { display: flex; gap: 3px; flex-shrink: 0; }
.flp-hdr-btn {
  width: 18px; height: 18px;
  border: none;
  background: rgba(255,255,255,0.06);
  border-radius: 4px;
  cursor: pointer;
  color: #888888;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  transition: background 0.12s, color 0.12s;
}
.flp-hdr-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }
.flp-close-btn:hover { background: rgba(200,50,50,0.4); }
.flp-resize-handle {
  position: absolute;
  bottom: 0; right: 0;
  width: 28px; height: 28px;
  cursor: se-resize;
  background: radial-gradient(circle at 75% 75%, #555 1.5px, transparent 1.5px) 4px 4px / 6px 6px,
              radial-gradient(circle at 75% 75%, #555 1.5px, transparent 1.5px) 10px 10px / 6px 6px,
              radial-gradient(circle at 75% 75%, #555 1.5px, transparent 1.5px) 16px 16px / 6px 6px;
}
</style>
