import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

function getChangelog(n = 8) {
  try {
    return execSync(`git log --format="%h|%s|%ad" --date=short -${n}`)
      .toString().trim().split('\n')
      .map(line => { const [hash, message, date] = line.split('|'); return { hash, message, date } })
  } catch { return [] }
}

export default defineConfig({
  define: {
    __APP_VERSION__:  JSON.stringify(Date.now().toString()),
    __GITHUB_URL__:   JSON.stringify('https://github.com/Restatw/Atelier'),
    __CHANGELOG__:    JSON.stringify(getChangelog()),
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Atelier',
        short_name: 'Atelier',
        description: 'A painting app',
        theme_color: '#111111',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [],
      },
    }),
  ],
  base: '/',
})
