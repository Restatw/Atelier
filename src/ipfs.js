export async function uploadToIPFS(blob, filename, config) {
  if (config.mode === 'pinata') {
    if (!config.jwt?.trim()) throw new Error('Pinata JWT is required')
    const form = new FormData()
    form.append('file', blob, filename)
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.jwt.trim()}` },
      body: form,
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText)
      throw new Error(`Pinata ${res.status}: ${msg}`)
    }
    return (await res.json()).IpfsHash
  }

  if (config.mode === 'local') {
    const nodeUrl = (config.nodeUrl || 'http://localhost:5001').replace(/\/$/, '')
    const form = new FormData()
    form.append('file', blob, filename)
    const res = await fetch(`${nodeUrl}/api/v0/add`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`IPFS node ${res.status}: ${res.statusText}`)
    return (await res.json()).Hash
  }

  throw new Error(`Unknown IPFS mode: ${config.mode}`)
}

export function getContentUrl(cid, config) {
  const gw = (config.gateway || 'https://ipfs.io').replace(/\/$/, '')
  return `${gw}/ipfs/${cid}`
}
