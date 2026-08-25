<template>
  <div class="sticky-layer">
    <div
      v-for="note in stickyNotes" :key="note.id"
      class="sticky-note"
      :class="{ 'sn-active': note.id === activeNoteId, 'sn-minimized': note.minimized }"
      :style="{ left: note.x+'px', top: note.y+'px', width: note.minimized ? '36px' : note.w+'px', height: note.minimized ? '36px' : note.h+'px', background: note.color, zIndex: note.z }"
      @mousedown.stop="bringToFront(note)"
      @touchstart.stop
    >
      <!-- Minimized: small square float button -->
      <template v-if="note.minimized">
        <div class="sn-mini-body"
          @mousedown.stop="startDrag(note, $event)"
          @touchstart.prevent.stop="startDragTouch(note, $event)"
          @click.stop="note.minimized = false">
          <StickyNote :size="16" style="opacity:0.55" />
        </div>
        <button class="sn-mini-close" @click.stop="deleteNote(note.id)" @mousedown.stop @touchstart.stop><X :size="9" /></button>
      </template>
      <!-- Expanded: full note -->
      <template v-else>
        <div class="sn-header"
          @mousedown.stop="startDrag(note, $event)"
          @touchstart.prevent.stop="startDragTouch(note, $event)">
          <div class="sn-colors">
            <button v-for="c in noteColors" :key="c" class="sn-color-dot"
              :style="{ background: c }"
              @click.stop="note.color = c" @mousedown.stop @touchstart.stop />
          </div>
          <div class="sn-btns">
            <button class="sn-minimize" @click.stop="note.minimized = true" @mousedown.stop @touchstart.stop :title="t('minimize')">
              <Minimize2 :size="11" />
            </button>
            <button class="sn-close" @click.stop="deleteNote(note.id)" @mousedown.stop @touchstart.stop><X :size="11" /></button>
          </div>
        </div>
        <textarea
          class="sn-text"
          v-model="note.text"
          :placeholder="t('stickyPlaceholder')"
          @mousedown.stop
          @touchstart.stop
        />
        <div class="sn-resize"
          @mousedown.stop="startResize(note, $event)"
          @touchstart.prevent.stop="startResizeTouch(note, $event)" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { StickyNote, Minimize2, X } from 'lucide-vue-next'
import { t } from '../../i18n.js'
import { useStickyNotes } from '../../composables/useStickyNotes.js'

// `plugin` is this widget's own registry manifest entry (see stickyNotes.js)
// — writing `placeAt` onto it here is how App.vue's onPointerDown finds
// this plugin's "place one here" action without knowing this component's
// internals.
//
// `viewRefs` bundles fitScale/viewR as plain-object properties rather than
// two separate props. A `:fit-scale="fitScale"` binding in the parent
// template would auto-unwrap the ref (Vue unwraps a bare top-level ref
// identifier in any template expression) and hand this component the
// current NUMBER instead of the live ref — dragging would then read
// undefined off that number forever, frozen at whatever value it had on
// mount. Passing `viewRefs.fitScale` (a plain property access, not a bare
// ref identifier) skips that auto-unwrap, so this component gets the real
// ref and stays reactive to zoom/rotate changes.
const props = defineProps({
  plugin: { type: Object, required: true },
  viewRefs: { type: Object, required: true },
})

const {
  stickyNotes, activeNoteId, noteColors,
  addStickyNoteAt, deleteNote, bringToFront,
  startDrag, startDragTouch, startResize, startResizeTouch,
  onSnMouseMove, onSnTouchMove, onSnMouseUp,
} = useStickyNotes(props.viewRefs.fitScale, props.viewRefs.viewR)

props.plugin.placeAt = addStickyNoteAt

onMounted(() => {
  window.addEventListener('mousemove', onSnMouseMove)
  window.addEventListener('mouseup',   onSnMouseUp)
  window.addEventListener('touchmove', onSnTouchMove, { passive: false })
  window.addEventListener('touchend',  onSnMouseUp)
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onSnMouseMove)
  window.removeEventListener('mouseup',   onSnMouseUp)
  window.removeEventListener('touchmove', onSnTouchMove)
  window.removeEventListener('touchend',  onSnMouseUp)
})
</script>

<style scoped>
.sticky-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}

.sticky-note {
  position: absolute;
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  box-shadow: 3px 5px 14px rgba(0,0,0,0.4);
  pointer-events: all;
  min-width: 120px;
  min-height: 80px;
  touch-action: manipulation;
}
.sticky-note.sn-active {
  box-shadow: 3px 5px 20px rgba(0,0,0,0.6), 0 0 0 2px rgba(96,96,204,0.6);
}

.sn-header {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  cursor: grab;
  flex-shrink: 0;
  background: rgba(0,0,0,0.1);
  border-radius: 5px 5px 0 0;
  gap: 4px;
}
.sn-header:active { cursor: grabbing; }

.sn-colors { display: flex; gap: 3px; }
.sn-color-dot {
  width: 12px; height: 12px;
  border-radius: 50%;
  border: 1.5px solid rgba(0,0,0,0.2);
  cursor: pointer; padding: 0;
  transition: transform 0.1s;
}
.sn-color-dot:hover { transform: scale(1.35); }

.sn-btns { display: flex; gap: 3px; flex-shrink: 0; margin-left: auto; }

.sn-minimize, .sn-close {
  width: 18px; height: 18px;
  border: none;
  background: rgba(0,0,0,0.12);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  color: #333;
  display: flex; align-items: center; justify-content: center;
  padding: 0; flex-shrink: 0;
}
.sn-minimize:hover { background: rgba(0,0,0,0.22); }
.sn-close:hover { background: rgba(200,50,50,0.4); color: #fff; }

.sticky-note.sn-minimized {
  min-width: 0; min-height: 0;
  border-radius: 9px;
  overflow: visible;
}

.sn-mini-body {
  width: 100%; height: 100%;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  cursor: grab;
}
.sn-mini-body:active { cursor: grabbing; }

.sn-mini-close {
  position: absolute;
  top: -6px; right: -6px;
  width: 16px; height: 16px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.55);
  color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}
.sn-mini-close:hover { background: rgba(200,50,50,0.85); }

.sn-text {
  flex: 1;
  border: none;
  background: transparent;
  resize: none;
  padding: 6px 8px;
  font-size: 16px;   /* ≥16px 避免 iOS 在 focus 時自動放大 viewport */
  font-family: inherit;
  color: #333;
  outline: none;
  box-shadow: none;
  -webkit-box-shadow: none;
  cursor: text;
  line-height: 1.5;
}

.sn-resize {
  position: absolute;
  bottom: 0; right: 0;
  width: 14px; height: 14px;
  cursor: se-resize;
  background: rgba(0,0,0,0.15);
  border-radius: 2px 0 5px 0;
  flex-shrink: 0;
}
</style>
