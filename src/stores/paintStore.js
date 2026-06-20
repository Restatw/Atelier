import { defineStore } from 'pinia'

export const usePaintStore = defineStore('paint', {
  state: () => ({
    layersMeta:    [],
    activeLayerId: null,
    canvasW:       1080,
    canvasH:       1920,
    layerIdSeq:    0,
    canvasBg:      '#1e1e1e',
    userPalette: [
      '#000000','#ffffff','#ef4444','#f97316','#eab308',
      '#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4',
      '#84cc16','#f59e0b','#14b8a6','#78716c','#94a3b8',
    ],
    ipfsMode:    'pinata',
    ipfsJwt:     '',
    ipfsNodeUrl: 'http://localhost:5001',
    ipfsGateway: 'https://ipfs.io',
  }),
  persist: true,
})
