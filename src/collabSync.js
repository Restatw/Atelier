// Thin wrapper around the atelier-sync WebSocket service. Only ever
// connects when a syncRoomId is present (widget room or standalone collab
// session) — see widgetContext.js. Fully inert otherwise.
import { io } from 'socket.io-client'
import { ref } from 'vue'
import { syncRoomId, isSyncActive } from './widgetContext.js'
import { generateIdentity } from './collabIdentity.js'

const SYNC_URL = import.meta.env.VITE_SYNC_URL || 'https://sync.re95.org'

let socket = null
export const myIdentity   = generateIdentity()
export const participants = ref([])   // [{ socketId, identity, activeLayerId }]
export const syncConnected = ref(false)

// Recent editing activity, for a Google-Docs-style "X is editing this"
// hint — distinct from `participants[].activeLayerId`, which only tracks
// which layer someone has *selected* and says nothing about whether they've
// actually touched it recently. One entry per (layerId, identity), replaced
// on every edit; entries past RECENT_EDIT_WINDOW_MS are stale and should be
// filtered out by readers (see prune() below for GC).
export const recentEdits = ref([]) // [{ layerId, identity, timestamp }]
export const RECENT_EDIT_WINDOW_MS = 60000

function recordEdit(payload) {
  if (!payload.identity) return
  const now = Date.now()
  for (const l of payload.layers || []) {
    const idx = recentEdits.value.findIndex(e => e.layerId === l.id && e.identity?.name === payload.identity.name)
    const entry = { layerId: l.id, identity: payload.identity, timestamp: now }
    if (idx !== -1) recentEdits.value[idx] = entry
    else recentEdits.value.push(entry)
  }
  // Opportunistic GC so this doesn't grow unbounded over a long session.
  recentEdits.value = recentEdits.value.filter(e => now - e.timestamp < RECENT_EDIT_WINDOW_MS * 2)
}

// callback invoked with the raw payload whenever a remote peer's update
// arrives. Set via initCollabSync().
let remoteUpdateHandler = null

export function initCollabSync({ onRemoteUpdate } = {}) {
  if (!isSyncActive) return
  remoteUpdateHandler = onRemoteUpdate || null

  socket = io(SYNC_URL)

  socket.on('connect', () => {
    syncConnected.value = true
    socket.emit('join', { roomId: syncRoomId, identity: myIdentity })
  })

  socket.on('disconnect', () => { syncConnected.value = false })

  socket.on('presence', (p) => { participants.value = p.participants || [] })

  socket.on('sync-state', (payload) => { remoteUpdateHandler?.(payload) })
  socket.on('canvas-update', (payload) => {
    recordEdit(payload)
    remoteUpdateHandler?.(payload)
  })
}

// Pushes changed layers out to peers. No-op when sync isn't active.
export function pushCanvasUpdate(payload) {
  if (!socket || !syncConnected.value) return
  socket.emit('canvas-update', payload)
}

// Lets peers know which layer this participant is currently working on, so
// everyone can show avatar badges on the right layer.
export function pushActiveLayer(layerId) {
  if (!socket || !syncConnected.value) return
  socket.emit('active-layer', { layerId })
}
