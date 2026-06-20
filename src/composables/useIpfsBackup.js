import { ref } from 'vue'
import { uploadToIPFS, getContentUrl } from '../ipfs.js'

export function useIpfsBackup({ getProjectData, getThumbnail, restoreProject, paintStore }) {
  const status       = ref('idle')   // 'idle' | 'uploading' | 'restoring' | 'done' | 'error'
  const statusMsg    = ref('')
  const lastCid      = ref(localStorage.getItem('atelier-last-cid') ?? '')
  const lastThumbCid = ref(localStorage.getItem('atelier-last-thumb') ?? '')
  const restoreCid   = ref('')
  const gatewayHint  = ref('')       // 'pinata' | full URL | '' — set before restoreFromCid()

  function config() {
    return {
      mode:    paintStore.ipfsMode,
      jwt:     paintStore.ipfsJwt,
      nodeUrl: paintStore.ipfsNodeUrl,
      gateway: paintStore.ipfsGateway,
    }
  }

  async function backupToIPFS() {
    status.value    = 'uploading'
    statusMsg.value = ''
    try {
      const cfg = config()
      const { blob, filename } = getProjectData()
      const cid = await uploadToIPFS(blob, filename, cfg)
      lastCid.value = cid
      localStorage.setItem('atelier-last-cid', cid)

      // Upload OG thumbnail (best-effort — failure doesn't abort backup)
      if (getThumbnail) {
        try {
          const thumbBlob = await getThumbnail()
          const thumbCid  = await uploadToIPFS(thumbBlob, `thumb-${Date.now()}.jpg`, cfg)
          lastThumbCid.value = thumbCid
          localStorage.setItem('atelier-last-thumb', thumbCid)
        } catch { /* thumbnail failure is non-fatal */ }
      }

      status.value = 'done'
    } catch (e) {
      status.value    = 'error'
      statusMsg.value = e.message
    }
  }

  // ipfs.io bypasses its Cloudflare cache when the request has an Origin
  // header (i.e. every JS fetch()), sending each request to the backend for
  // a DHT lookup that takes 30–60 s and usually 504s.
  // Pinata and w3s gateways return cache HITs regardless of Origin, so put
  // them first.  The user's configured gateway comes after as a last resort.
  function gatewayList(cid) {
    const cfg = config()
    const configured = getContentUrl(cid, cfg)
    const pinata = 'https://gateway.pinata.cloud'

    // Resolve hint from share URL (&gw=pinata or &gw=https://...)
    const hint = gatewayHint.value.trim()
    let hintUrl = ''
    if (hint === 'pinata')  hintUrl = `${pinata}/ipfs/${cid}`
    else if (hint)          hintUrl = `${hint.replace(/\/$/, '')}/ipfs/${cid}`

    // dweb.link and ipfs.io set cf-cache-status:BYPASS for JS fetch() (Origin header),
    // causing DHT lookups that 504. gateway.pinata.cloud and w3s.link cache regardless.
    const ordered = cfg.mode === 'pinata'
      ? [pinata, 'https://w3s.link']
      : ['https://w3s.link', 'https://ipfs.io']

    const seen = new Set()
    const list = []
    if (hintUrl) { seen.add(hintUrl); list.push(hintUrl) }
    for (const gw of ordered) {
      const url = `${gw}/ipfs/${cid}`
      if (!seen.has(url)) { seen.add(url); list.push(url) }
    }
    if (!seen.has(configured)) list.push(configured)
    return list
  }

  async function fetchWithTimeout(url, timeoutMs = 15000) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(url, { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  async function fetchCid(cid) {
    const urls = gatewayList(cid)
    let lastErr = ''
    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(url)
        if (res.ok) return res
        lastErr = `HTTP ${res.status}`
        console.warn(`[IPFS] ${url} → ${res.status}`)
      } catch (e) {
        lastErr = e.message
        console.warn(`[IPFS] ${url} failed: ${e.message}`)
      }
    }
    throw new Error(`All gateways failed (last: ${lastErr})`)
  }

  async function restoreFromCid() {
    const cid = restoreCid.value.trim()
    if (!cid) return
    status.value    = 'restoring'
    statusMsg.value = ''
    try {
      const res     = await fetchCid(cid)
      const project = await res.json()
      await restoreProject(project)
      lastCid.value    = cid
      localStorage.setItem('atelier-last-cid', cid)
      restoreCid.value = ''
      status.value     = 'done'
    } catch (e) {
      status.value    = 'error'
      statusMsg.value = e.message
      console.error('[IPFS] restore failed:', e)
    }
  }

  function copyLastCid() {
    if (lastCid.value) navigator.clipboard?.writeText(lastCid.value)
  }

  function openLastCid() {
    if (!lastCid.value) return
    window.open(getContentUrl(lastCid.value, config()), '_blank')
  }

  return { status, statusMsg, lastCid, lastThumbCid, restoreCid, gatewayHint, backupToIPFS, restoreFromCid, copyLastCid, openLastCid }
}
