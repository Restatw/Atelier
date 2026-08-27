// Thin wrapper around the atelier sync Durable Object. Only ever connects
// when a syncRoomId is present (widget room or standalone collab session) —
// see widgetContext.js. Fully inert otherwise.
import { ref } from 'vue'
import { syncRoomId, isSyncActive } from './widgetContext.js'
import { generateIdentity } from './collabIdentity.js'

// Same-origin by default — the sync room lives inside the atelier Worker
// itself (cloudflare-worker/syncRoom.js), not a separate service. Override
// via VITE_SYNC_URL only for pointing local dev at a different deployment.
function defaultSyncBase() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/sync`
}
const SYNC_BASE = import.meta.env.VITE_SYNC_URL || defaultSyncBase()

const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 15000

let socket = null
let reconnectAttempt = 0
let reconnectTimer = null
let stopped = true

export const myIdentity   = generateIdentity()
export const participants = ref([])   // [{ socketId, identity, activeLayerId }]
export const syncConnected = ref(false)

// Resolves once this client's initial 'join' round-trip has settled — see
// waitForJoin() below for why callers (App.vue's onMounted) need this.
let firstPresenceResolve
let firstPresence = new Promise(resolve => { firstPresenceResolve = resolve })

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
    const idx = recentEdits.value.findIndex(e => e.layerId === l.id && e.identity?.id === payload.identity.id)
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

function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(payload))
}

function connect() {
  socket = new WebSocket(`${SYNC_BASE}/${encodeURIComponent(syncRoomId)}`)

  socket.addEventListener('open', () => {
    reconnectAttempt = 0
    syncConnected.value = true
    send({ type: 'join', identity: myIdentity })
  })

  socket.addEventListener('close', () => {
    syncConnected.value = false
    scheduleReconnect()
  })

  socket.addEventListener('error', () => socket?.close())

  socket.addEventListener('message', (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }

    if (msg.type === 'presence') {
      participants.value = msg.participants || []
      firstPresenceResolve()
    } else if (msg.type === 'sync-state') {
      remoteUpdateHandler?.(msg)
    } else if (msg.type === 'canvas-update') {
      recordEdit(msg)
      remoteUpdateHandler?.(msg)
    }
  })
}

function scheduleReconnect() {
  if (stopped) return
  clearTimeout(reconnectTimer)
  const delay = Math.min(RECONNECT_MIN_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS)
  reconnectAttempt++
  reconnectTimer = setTimeout(connect, delay)
}

export function initCollabSync({ onRemoteUpdate } = {}) {
  if (!isSyncActive) return
  remoteUpdateHandler = onRemoteUpdate || null
  stopped = false
  connect()
}

// Waits until this client's initial join has settled — i.e. until we know
// whether the room already had state (canvas size, existing layers) to
// hand us. The server always sends 'sync-state' (if the room has any)
// *before* the 'presence' broadcast on the same join, and WebSocket
// preserves per-connection message order, so "first presence received"
// is a reliable signal that any sync-state has already arrived and had
// its (synchronous) canvas-size correction applied in useLayers.js's
// applyRemoteLayers — see App.vue's onMounted, which awaits this before
// ensureOwnLayer() reads the canvas size to create this participant's own
// layer. Without it, a joiner on a slow connection can create (and then
// broadcast) a layer sized to their own device's default before the
// room's real size arrives, clobbering it for everyone else — the
// "canvas turns portrait when someone joins from a phone" bug.
//
// Falls back to a timeout so a genuinely offline/unreachable connection
// doesn't block layer creation forever; no-ops (resolves immediately)
// when sync isn't active at all.
export function waitForJoin(timeoutMs = 2500) {
  if (!isSyncActive) return Promise.resolve()
  return Promise.race([
    firstPresence,
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ])
}

// Pushes changed layers out to peers. No-op when sync isn't active.
export function pushCanvasUpdate(payload) {
  if (!syncConnected.value) return
  send({ type: 'canvas-update', ...payload })
}

// Lets peers know which layer this participant is currently working on, so
// everyone can show avatar badges on the right layer.
export function pushActiveLayer(layerId) {
  if (!syncConnected.value) return
  send({ type: 'active-layer', layerId })
}
