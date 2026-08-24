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

// Keep in sync with MAX_LAYERS in src/composables/useLayers.js.
const MAX_LAYERS = 50

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
          return { id, name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked, ownerId: l.ownerId, dataURL: l.dataURL, rev: l.rev }
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

      const applied = []
      const rejectedStale = []
      const rejectedForeign = []
      const rejectedLimit = []
      for (const incoming of msg.layers) {
        const existing = this.layers.get(incoming.id)

        // Layer cap: shared across the whole room (not per person) — a
        // genuinely new layer id is refused once the room's at MAX_LAYERS,
        // but updates to an already-existing layer always go through
        // regardless, since those don't grow the count. Client-side
        // useLayers.js enforces the same cap for immediate UI feedback;
        // this is the backstop for a stale or misbehaving client, same
        // reasoning as the ownership guard below.
        if (!existing && this.layers.size >= MAX_LAYERS) {
          rejectedLimit.push(`${incoming.id}(room at ${this.layers.size}/${MAX_LAYERS} layers)`)
          continue
        }

        // Ownership guard: once a layer has a recorded owner, only that
        // owner's own connection may write to it again — including
        // creating it in the first place under someone else's claimed
        // ownerId. A layer with no recorded owner (legacy content from
        // before this feature) stays writable by anyone, matching the
        // client's own isLayerEditable() rule. This isn't real access
        // control — identity is self-asserted at join and never verified,
        // so a deliberately misbehaving client could still lie about who
        // it is. What this actually guards against is a buggy or stale
        // *legitimate* client accidentally re-pushing a peer's layer with
        // re-encoded bytes (decode → drawImage → re-encode isn't
        // guaranteed byte-identical — see useLayers.js's pushChangesToSync
        // comment), which is exactly what caused layers to silently revert
        // during this app's development.
        const ownerOfRecord = existing?.ownerId ?? incoming.ownerId ?? null
        if (ownerOfRecord && ownerOfRecord !== p.identity?.id) {
          rejectedForeign.push(`${incoming.id}(owner=${ownerOfRecord} socket identity=${p.identity?.id})`)
          continue
        }

        // Stale/out-of-order delivery guard: ignore if we've already
        // applied an equal-or-newer revision for this layer. Also the
        // tripwire for two peers' layer ids colliding (see collabSync.js's
        // freshLayerIdSeq comment) — a collision shows up here as one
        // peer's genuinely new layer getting silently rejected because it
        // happens to reuse an id the room already has a newer rev for.
        if (existing && existing.rev >= incoming.rev) {
          rejectedStale.push(`${incoming.id}(existing owner=${existing.ownerId} rev=${existing.rev} vs incoming owner=${incoming.ownerId} rev=${incoming.rev})`)
          continue
        }
        this.layers.set(incoming.id, {
          name: incoming.name, visible: incoming.visible, opacity: incoming.opacity,
          locked: incoming.locked, ownerId: incoming.ownerId,
          dataURL: incoming.dataURL, rev: incoming.rev,
        })
        applied.push(incoming)
      }
      const removedOk = []
      if (Array.isArray(msg.removedLayerIds)) {
        for (const id of msg.removedLayerIds) {
          const existing = this.layers.get(id)
          if (existing?.ownerId && existing.ownerId !== p.identity?.id) {
            rejectedForeign.push(`${id}(delete blocked, owner=${existing.ownerId} socket identity=${p.identity?.id})`)
            continue
          }
          this.layers.delete(id)
          removedOk.push(id)
        }
      }

      // Merge, don't replace: a sender's layerOrder only reflects the
      // layers *they* know about locally. Applying it verbatim would drop
      // any layer this room actually still has (e.g. one a peer just
      // created, or one this sender tried to delete but the ownership
      // guard above rejected) out of snapshotState() for future joiners,
      // even though this.layers still has it.
      if (Array.isArray(msg.layerOrder)) {
        const known = new Set(this.layers.keys())
        const merged = msg.layerOrder.filter(id => known.has(id))
        for (const id of known) if (!merged.includes(id)) merged.push(id)
        this.layerOrder = merged
      }

      this.log(`canvas-update socket=${socketId} applied=[${applied.map(l => `${l.id}:${l.rev}`).join(',')}]`
        + (rejectedStale.length ? ` rejected_stale=[${rejectedStale.join(';')}]` : '')
        + (rejectedForeign.length ? ` rejected_foreign=[${rejectedForeign.join(';')}]` : '')
        + (rejectedLimit.length ? ` rejected_limit=[${rejectedLimit.join(';')}]` : '')
        + (removedOk.length ? ` removed=[${removedOk.join(',')}]` : '')
        + ` layerOrder=[${(this.layerOrder || []).join(',')}]`)

      if (applied.length || removedOk.length) {
        this.broadcast({
          type: 'canvas-update',
          canvasW: this.canvasW, canvasH: this.canvasH,
          layerOrder: this.layerOrder,
          layers: applied,
          removedLayerIds: removedOk,
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
