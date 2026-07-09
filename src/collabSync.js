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
  socket.on('canvas-update', (payload) => { remoteUpdateHandler?.(payload) })
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
