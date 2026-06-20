/**
 * Atelier OG Preview Worker
 *
 * Deploy as a Cloudflare Worker with route: atelier.re95.org/*
 *
 * When Discord / Telegram bots fetch a share URL like:
 *   https://atelier.re95.org/?cid=Qm...&thumb=Qm...&gw=pinata
 *
 * this Worker returns lightweight HTML with og:image pointing to the
 * thumbnail on IPFS.  Regular users get the normal SPA response.
 */

const BOT_RE = /discord|telegram|twitterbot|facebot|linkedinbot|slackbot|whatsapp|line\/|snapchat/i

const THUMB_GW = 'https://gateway.pinata.cloud/ipfs'

export default {
  async fetch(request, env, ctx) {
    const ua = request.headers.get('User-Agent') ?? ''
    if (!BOT_RE.test(ua)) {
      // Regular user — pass through to origin unchanged
      return fetch(request)
    }

    const url   = new URL(request.url)
    const thumb = url.searchParams.get('thumb')
    const cid   = url.searchParams.get('cid')

    const imageUrl = thumb
      ? `${THUMB_GW}/${thumb}`
      : `${url.origin}/icon-512.png`

    const title = cid
      ? 'Atelier — Shared Artwork'
      : 'Atelier'

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta property="og:type"        content="website" />
  <meta property="og:site_name"   content="Atelier" />
  <meta property="og:title"       content="${title}" />
  <meta property="og:description" content="Open this painting in Atelier" />
  <meta property="og:image"       content="${imageUrl}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url"         content="${url.href}" />
  <meta name="twitter:card"       content="summary_large_image" />
  <meta name="twitter:image"      content="${imageUrl}" />
</head>
<body></body>
</html>`

    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    })
  },
}
