// Minimal Matrix Widget API integration. Only activates when the app is
// opened as an Element widget (widgetId present in the URL) — standalone
// use never touches this module's guts.
import { WidgetApi, WidgetEventCapability, EventDirection } from 'matrix-widget-api'
import { isWidget, widgetId } from './widgetContext.js'

let api = null
let ready = false

// Call once, early (see main.js). Safe to call in non-widget contexts —
// it's a no-op then.
export function initWidgetApi() {
  if (!isWidget) return null
  try {
    api = new WidgetApi(widgetId)
    api.requestCapability(WidgetEventCapability.forRoomMessageEvent(EventDirection.Send).raw)
    api.on('ready', () => { ready = true })
    api.start()
    // Tells the host client the widget has finished loading (removes any
    // loading spinner it may be showing around the iframe).
    api.sendContentLoaded()
  } catch (e) {
    console.warn('[widgetApi] init failed:', e)
    api = null
  }
  return api
}

// Sends a text message into the room this widget is running in. Returns
// true on success so callers can fall back to something else (e.g. copying
// a link to the clipboard) when this isn't available or fails.
export async function sendRoomMessage(body) {
  if (!api) return false
  try {
    await api.sendRoomEvent('m.room.message', { msgtype: 'm.text', body })
    return true
  } catch (e) {
    console.warn('[widgetApi] sendRoomMessage failed:', e)
    return false
  }
}

export function isWidgetReady() {
  return ready
}
