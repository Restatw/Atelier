import { StickyNote } from 'lucide-vue-next'
import { registerPlugin } from '../registry.js'
import StickyNotesWidget from './StickyNotesWidget.vue'

registerPlugin({
  id: 'sticky-notes',
  type: 'widget',
  label: 'addStickyNote', // i18n key, used as the toolbar button's title
  icon: StickyNote,
  component: StickyNotesWidget,
  // `asTool: true` means clicking this plugin's toolbar button selects it
  // as the active tool (currentTool.value = 'sticky-notes') instead of
  // firing an instant action — placement then happens on the next canvas
  // click, same as eyedropper/text. App.vue's onPointerDown looks up
  // `placeAt` for whichever widget-as-tool plugin is currentTool.value.
  asTool: true,
  // Set by StickyNotesWidget.vue once it mounts.
  placeAt: null,
})
