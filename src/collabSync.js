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
    console.log(`[sync:${myIdentity.name}] connected, joining room`, syncRoomId)
    socket.emit('join', { roomId: syncRoomId, identity: myIdentity })
  })

  socket.on('disconnect', () => {
    syncConnected.value = false
    console.log(`[sync:${myIdentity.name}] disconnected`)
  })

  socket.on('presence', (p) => { participants.value = p.participants || [] })

  socket.on('sync-state', (payload) => {
    console.log(`[sync:${myIdentity.name}] RECV sync-state`, {
      canvasW: payload.canvasW, canvasH: payload.canvasH,
      layerOrder: payload.layerOrder,
      layers: (payload.layers || []).map(l => ({ id: l.id, rev: l.rev, len: l.dataURL?.length })),
    })
    remoteUpdateHandler?.(payload)
  })
  socket.on('canvas-update', (payload) => {
    console.log(`[sync:${myIdentity.name}] RECV canvas-update`, {
      canvasW: payload.canvasW, canvasH: payload.canvasH,
      layerOrder: payload.layerOrder,
      layers: (payload.layers || []).map(l => ({ id: l.id, rev: l.rev, len: l.dataURL?.length })),
      removedLayerIds: payload.removedLayerIds,
    })
    remoteUpdateHandler?.(payload)
  })
}

// Pushes changed layers out to peers. No-op when sync isn't active.
export function pushCanvasUpdate(payload) {
  if (!socket || !syncConnected.value) {
    console.log(`[sync:${myIdentity.name}] SKIP push (not connected)`, payload)
    return
  }
  console.log(`[sync:${myIdentity.name}] SEND canvas-update`, {
    canvasW: payload.canvasW, canvasH: payload.canvasH,
    layerOrder: payload.layerOrder,
    layers: (payload.layers || []).map(l => ({ id: l.id, rev: l.rev, len: l.dataURL?.length })),
    removedLayerIds: payload.removedLayerIds,
  })
  socket.emit('canvas-update', payload)
}

// Lets peers know which layer this participant is currently working on, so
// everyone can show avatar badges on the right layer.
export function pushActiveLayer(layerId) {
  if (!socket || !syncConnected.value) return
  socket.emit('active-layer', { layerId })
}
