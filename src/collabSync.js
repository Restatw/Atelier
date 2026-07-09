// Thin wrapper around the atelier-sync WebSocket service. Only ever
// connects when a syncRoomId is present (widget room or standalone collab
// session) — see widgetContext.js. Fully inert otherwise.
import { io } from 'socket.io-client'
import { ref } from 'vue'
import { syncRoomId, isSyncActive } from './widgetContext.js'

const SYNC_URL = import.meta.env.VITE_SYNC_URL || 'https://sync.re95.org'

let socket = null
export const presenceCount = ref(1)
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
    socket.emit('join', { roomId: syncRoomId })
  })

  socket.on('disconnect', () => { syncConnected.value = false })

  socket.on('presence', (p) => { presenceCount.value = p.count })

  socket.on('sync-state', (payload) => { remoteUpdateHandler?.(payload) })
  socket.on('canvas-update', (payload) => { remoteUpdateHandler?.(payload) })
}

// Pushes the local canvas state out to peers. No-op when sync isn't active.
export function pushCanvasUpdate(payload) {
  if (!socket || !syncConnected.value) return
  socket.emit('canvas-update', payload)
}
