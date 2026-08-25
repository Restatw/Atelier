import { reactive } from 'vue'

// Central plugin registry. A plugin is a plain manifest object; nothing here
// enforces its shape beyond `id` + `type` because different plugin types
// (brush / widget) need different fields — see builtin/*.js for the shapes
// actually in use today.
//
// There's no enabled/disabled state here — every registered plugin is
// always "live" (reachable by its tool id, its widget always mounted).
// Whether a plugin's *button* shows up anywhere, and in what order, is
// entirely App.vue's job: the toolbar and the brush tool-list each keep
// their own persisted order + hidden-id list (see toolbarLayout /
// toolsLayout in App.vue) covering both built-in entries and plugin ids
// alike, with an "Add" picker to bring a hidden one back. A `core: true`
// plugin (pen/brush/eraser) is simply never put in either of those
// removable lists, so it's always shown — see toolbarCatalog / `tools` in
// App.vue for where that's enforced.
//
// `plugins` is reactive so App.vue can build toolbar buttons / render loops
// straight off getPlugins(type) and have them update if a plugin is ever
// registered after startup (e.g. lazy-loaded).
const plugins = reactive([])

export function registerPlugin(manifest) {
  if (!manifest?.id || !manifest?.type) {
    console.warn('[plugins] registerPlugin() requires at least { id, type }', manifest)
    return
  }
  if (plugins.some(p => p.id === manifest.id)) {
    console.warn(`[plugins] duplicate plugin id "${manifest.id}", ignoring`)
    return
  }
  plugins.push(manifest)
}

export function getPlugins(type) {
  return plugins.filter(p => !type || p.type === type)
}

export function getPlugin(id) {
  return plugins.find(p => p.id === id)
}
