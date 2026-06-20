import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import App from './App.vue'
import './style.css'

const VERSION_KEY = 'atelier-version'
const CURRENT     = __APP_VERSION__
const stored      = localStorage.getItem(VERSION_KEY)

// Only trigger refresh when the stored version differs from the current build.
// Do NOT check ?v= in the URL — share links keep that param intact across reloads,
// which would cause an infinite reload loop.
const needsUpdate = stored && stored !== CURRENT

async function bootstrap() {
  if (needsUpdate) {
    // Write new version first to prevent infinite reload loops
    localStorage.setItem(VERSION_KEY, CURRENT)
    // Clear all Workbox / browser caches so the next load fetches fresh assets
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
    // Reload keeping the URL intact (so ?cid=&gw=&v= params survive)
    location.reload()
    return
  }
  localStorage.setItem(VERSION_KEY, CURRENT)

  const app   = createApp(App)
  const pinia = createPinia()
  pinia.use(createPersistedState())
  app.use(pinia)
  app.mount('#app')
}

bootstrap()
