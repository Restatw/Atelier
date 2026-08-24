/**
 * SyncRoom — one Durable Object instance per collaboration room
 * (env.SYNC_ROOM.getByName(roomId)), replacing the atelier-sync Node/
 * socket.io service. State shape mirrors that service's per-room object
 * 1:1; the outer `rooms: Map<roomId, room>` from server.js is gone because
 * each DO instance *is* one room.
 *
 * Deliberately in-memory only, no ctx.storage — same "ephemeral, gone when
 * everyone leaves" behaviour as before. This also uses the *standard*
 * (non-hibernating) WebSocket accept() API rather than
 * ctx.acceptWebSocket(): a hibernating DO wipes its JS heap between events
 * and only persists WebSocket attachments up to 16KB, far below what a
 * single canvas layer dataURL can run (several MB — see
 * maxHttpBufferSize in the old server.js). Hibernating would silently drop
 * in-progress layers on any idle gap. Standard accept() keeps the DO
 * resident (and billed) for as long as any client stays connected — same
 * lifetime characteristics as the always-on Node process it replaces, and
 * cheap at this app's traffic scale.
 */
import { DurableObject } from 'cloudflare:workers'

export class SyncRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.canvasW = null
    this.canvasH = null
    this.layerOrder = []
    this.layers = new Map()
    this.participants = new Map() // ws -> { socketId, identity, activeLayerId }
  }

  roomHasState() {
    return this.layerOrder.length > 0
  }

  snapshotState() {
    return {
      canvasW: this.canvasW,
      canvasH: this.canvasH,
      layers: this.layerOrder
        .filter(id => this.layers.has(id))
        .map(id => {
          const l = this.layers.get(id)
          return { id, name: l.name, visible: l.visible, opacity: l.opacity, dataURL: l.dataURL, rev: l.rev }
        }),
    }
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)) } catch {}
  }

  broadcast(msg, exclude) {
    const data = JSON.stringify(msg)
    for (const ws of this.participants.keys()) {
      if (ws === exclude) continue
      try { ws.send(data) } catch {}
    }
  }

  broadcastPresence() {
    const list = Array.from(this.participants.values()).map(p => ({
      socketId: p.socketId, identity: p.identity, activeLayerId: p.activeLayerId,
    }))
    this.broadcast({ type: 'presence', participants: list })
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    const socketId = crypto.randomUUID()
    this.participants.set(server, { socketId, identity: null, activeLayerId: null })
    this.log(`connect socket=${socketId} ip=${ip}`)

    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data, socketId, ip)
    })
    const onClose = () => {
      this.participants.delete(server)
      this.log(`disconnect socket=${socketId} ip=${ip}`)
      this.broadcastPresence()
    }
    server.addEventListener('close', onClose)
    server.addEventListener('error', onClose)

    return new Response(null, { status: 101, webSocket: client })
  }

  log(message) {
    console.log(`[sync-room] ${new Date().toISOString()} ${message}`)
  }

  handleMessage(ws, raw, socketId, ip) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    const p = this.participants.get(ws)
    if (!p) return

    if (msg.type === 'join') {
      p.identity = msg.identity || null
      this.log(`join socket=${socketId} ip=${ip}`)
      if (this.roomHasState()) this.send(ws, { type: 'sync-state', ...this.snapshotState() })
      this.broadcastPresence()
      return
    }

    if (msg.type === 'canvas-update') {
      if (!msg.layers) return
      this.canvasW = msg.canvasW ?? this.canvasW
      this.canvasH = msg.canvasH ?? this.canvasH
      if (Array.isArray(msg.layerOrder)) this.layerOrder = msg.layerOrder

      const applied = []
      for (const incoming of msg.layers) {
        const existing = this.layers.get(incoming.id)
        // Stale/out-of-order delivery guard: ignore if we've already
        // applied an equal-or-newer revision for this layer.
        if (existing && existing.rev >= incoming.rev) continue
        this.layers.set(incoming.id, {
          name: incoming.name, visible: incoming.visible, opacity: incoming.opacity,
          dataURL: incoming.dataURL, rev: incoming.rev,
        })
        applied.push(incoming)
      }
      if (Array.isArray(msg.removedLayerIds)) {
        for (const id of msg.removedLayerIds) this.layers.delete(id)
      }

      if (applied.length || msg.removedLayerIds?.length) {
        this.broadcast({
          type: 'canvas-update',
          canvasW: this.canvasW, canvasH: this.canvasH,
          layerOrder: this.layerOrder,
          layers: applied,
          removedLayerIds: msg.removedLayerIds || [],
          identity: p.identity,
        }, ws)
      }
      return
    }

    if (msg.type === 'active-layer') {
      p.activeLayerId = msg.layerId ?? null
      this.broadcastPresence()
      return
    }
  }
}
