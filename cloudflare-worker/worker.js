/**
 * Atelier main Worker
 *
 * /sync/<roomId> — WebSocket upgrade for live canvas collaboration,
 *   forwarded to a SyncRoom Durable Object (one instance per room).
 * /og?cid=...&thumb=... — OG preview page (no static asset, Worker always runs)
 *   Bots get OG meta tags; browsers get meta-refresh to the actual app.
 * / on re95.org / www.re95.org (no cid/widgetId/matrix_room_id) — static
 *   marketing landing page (public/landing.html) instead of the app itself.
 *   atelier.re95.org is unaffected — it's the explicit "launch the app"
 *   destination the landing page links to. Query-param exceptions matter:
 *   a shared IPFS link's /og redirect (below) lands on `/?cid=...`, and
 *   collab/widget embeds read their own ids from the query string too, so
 *   those must still reach the SPA rather than the landing page.
 *
 * Everything else — static assets (dist/)
 */

export { SyncRoom } from './syncRoom.js'

const THUMB_GW = 'https://gateway.pinata.cloud/ipfs'
const SYNC_PATH_PREFIX = '/sync/'
const LANDING_HOSTS = new Set(['re95.org', 'www.re95.org'])
const LANDING_EXEMPT_PARAMS = ['cid', 'widgetId', 'matrix_room_id']

// HTML-attribute-escapes a value before it's interpolated into the /og
// template below. Every value in that template is attacker-controlled (it
// comes straight from the request's own query string), so skipping this
// for any of them is a reflected-XSS hole — see the /og handler.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

// Safe to splice into an inline <script> as `location.replace(<this>)`.
// JSON.stringify alone isn't enough: it doesn't escape "<", so a value
// containing a literal "</script>" would close the tag early regardless of
// being inside a JS string literal, letting attacker-controlled query-string
// content run as markup/script right after.
function toInlineScriptString(str) {
  return JSON.stringify(str).replace(/</g, '\\u003c')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith(SYNC_PATH_PREFIX)) {
      const roomId = decodeURIComponent(url.pathname.slice(SYNC_PATH_PREFIX.length)).slice(0, 128)
      if (!roomId) return new Response('missing room id', { status: 400 })
      const ip = request.headers.get('cf-connecting-ip') || 'unknown'
      const { success } = await env.SYNC_LIMITER.limit({ key: ip })
      if (!success) return new Response('rate limited', { status: 429 })
      const stub = env.SYNC_ROOM.getByName(roomId)
      return stub.fetch(request)
    }

    if (
      LANDING_HOSTS.has(url.hostname) &&
      url.pathname === '/' &&
      !LANDING_EXEMPT_PARAMS.some(p => url.searchParams.has(p))
    ) {
      // Cloudflare's asset handler serves .html files at their extension-
      // less "clean URL" and 307-redirects the .html form to it — request
      // that form directly rather than following a redirect.
      return env.ASSETS.fetch(new Request(new URL('/landing', url), request))
    }

    if (url.pathname !== '/og') {
      return env.ASSETS.fetch(request)
    }

    const thumb = url.searchParams.get('thumb')
    const cid   = url.searchParams.get('cid')

    const imageUrl = thumb
      ? `${THUMB_GW}/${thumb}`
      : `${url.origin}/icon-512.png`

    const title  = cid ? 'Atelier — Shared Artwork' : 'Atelier'
    const appUrl = `${url.origin}/?${url.searchParams.toString()}`

    const safeTitle    = escapeHtml(title)
    const safeImageUrl = escapeHtml(imageUrl)
    const safeAppUrl    = escapeHtml(appUrl)
    const safeHref      = escapeHtml(url.href)

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle}</title>
  <meta http-equiv="refresh" content="0;url=${safeAppUrl}" />
  <meta property="og:type"         content="website" />
  <meta property="og:site_name"    content="Atelier" />
  <meta property="og:title"        content="${safeTitle}" />
  <meta property="og:description"  content="Open this painting in Atelier" />
  <meta property="og:image"        content="${safeImageUrl}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url"          content="${safeHref}" />
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:image"       content="${safeImageUrl}" />
</head>
<body><script>location.replace(${toInlineScriptString(appUrl)})<\/script></body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store',
      },
    })
  },
}
