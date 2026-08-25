import { ref } from 'vue'

export function useStickyNotes(fitScale, viewR) {
  let snIdSeq = 0
  let snZSeq  = 0
  const stickyNotes  = ref([])
  const activeNoteId = ref(null)
  const noteColors   = ['#fef08a','#86efac','#93c5fd','#f9a8d4','#fca5a5','#d8b4fe']

  // (x, y) is a click point in canvas-vp local space — the same coordinate
  // system canvasPoint() in App.vue produces, which is what note.x/note.y
  // are already stored in (see onSnMouseMove below, which drags notes in
  // that same rotate/scale-corrected space). Centers the note on the
  // click point, same convention as a brush stamping under the cursor.
  function addStickyNoteAt(x, y) {
    const w = 180, h = 140
    stickyNotes.value.push({
      id: ++snIdSeq, x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h,
      text: '', color: '#fef08a', z: ++snZSeq, minimized: false
    })
    activeNoteId.value = snIdSeq
  }

  function deleteNote(id) {
    stickyNotes.value = stickyNotes.value.filter(n => n.id !== id)
    if (activeNoteId.value === id) activeNoteId.value = null
  }

  function bringToFront(note) {
    note.z = ++snZSeq
    activeNoteId.value = note.id
  }

  let dragNote = null, dragOx = 0, dragOy = 0, dragNx = 0, dragNy = 0
  let resNote  = null, resOx  = 0, resOy  = 0, resNw  = 0, resNh  = 0

  function startDrag(note, e) {
    bringToFront(note)
    dragNote = note; dragOx = e.clientX; dragOy = e.clientY
    dragNx = note.x; dragNy = note.y
  }
  function startDragTouch(note, e)   { startDrag(note, e.touches[0]) }
  function startResize(note, e) {
    bringToFront(note)
    resNote = note; resOx = e.clientX; resOy = e.clientY
    resNw = note.w; resNh = note.h
  }
  function startResizeTouch(note, e) { startResize(note, e.touches[0]) }

  function onSnMouseMove(e) {
    if (dragNote) {
      const s = fitScale.value
      const rad = -viewR.value * Math.PI / 180
      const dx = e.clientX - dragOx
      const dy = e.clientY - dragOy
      dragNote.x = dragNx + (dx * Math.cos(rad) - dy * Math.sin(rad)) / s
      dragNote.y = dragNy + (dx * Math.sin(rad) + dy * Math.cos(rad)) / s
    }
    if (resNote) {
      const s = fitScale.value
      resNote.w = Math.max(120, resNw + (e.clientX - resOx) / s)
      resNote.h = Math.max(80,  resNh + (e.clientY - resOy) / s)
    }
  }
  function onSnTouchMove(e) {
    if (dragNote || resNote) { e.preventDefault(); onSnMouseMove(e.touches[0]) }
  }
  function onSnMouseUp() { dragNote = null; resNote = null }

  return {
    stickyNotes, activeNoteId, noteColors,
    addStickyNoteAt, deleteNote, bringToFront,
    startDrag, startDragTouch, startResize, startResizeTouch,
    onSnMouseMove, onSnTouchMove, onSnMouseUp,
  }
}
