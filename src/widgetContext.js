// Reads the URL parameters a Matrix client (e.g. Element) substitutes in
// when this app is embedded as a room widget (see /addwidget $matrix_room_id
// style templating). Every export here degrades to a harmless empty value
// when the app is opened standalone (direct browser visit, PWA), so none of
// this changes behaviour outside of the widget context.
const params = new URLSearchParams(window.location.search)

const rawRoomId = params.get('matrix_room_id') || ''
export const roomNamespace = rawRoomId ? rawRoomId.replace(/[^a-zA-Z0-9_-]/g, '_') : ''

export const widgetId = params.get('widgetId') || ''
export const isWidget = !!widgetId

export const widgetTheme  = params.get('theme') || ''
export const matrixUserId = params.get('matrix_user_id') || ''
