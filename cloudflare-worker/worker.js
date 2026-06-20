/**
 * Atelier main Worker
 *
 * /og?cid=...&thumb=... — OG preview page (no static asset, Worker always runs)
 *   Bots get OG meta tags; browsers get meta-refresh to the actual app.
 *
 * Everything else — static assets (dist/)
 */

const THUMB_GW = 'https://gateway.pinata.cloud/ipfs'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

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

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta http-equiv="refresh" content="0;url=${appUrl}" />
  <meta property="og:type"         content="website" />
  <meta property="og:site_name"    content="Atelier" />
  <meta property="og:title"        content="${title}" />
  <meta property="og:description"  content="Open this painting in Atelier" />
  <meta property="og:image"        content="${imageUrl}" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url"          content="${url.href}" />
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:image"       content="${imageUrl}" />
</head>
<body><script>location.replace(${JSON.stringify(appUrl)})<\/script></body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store',
      },
    })
  },
}
