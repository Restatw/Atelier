import { Pencil, Brush, Eraser, SprayCan } from 'lucide-vue-next'
import { registerPlugin } from '../registry.js'

// Brush plugin shape:
//   mode: 'path' | 'stamp'
//   - 'path' plugins implement paint(ctx, points, settings) and get called
//     once per animation frame with the FULL point list of the stroke so
//     far — the runner always restores a clean layer snapshot first, so
//     paint() should draw the whole path as if for the first time. Good
//     for a smooth vector-style stroke with no dab texture, but gets no
//     real Flow build-up (see App.vue's renderBrushPath for why) — no
//     built-in plugin uses this any more.
//   - 'stamp' plugins implement stamp(ctx, point, settings) and get called
//     once per interpolated dab position (spaced `stampSpacing` px apart,
//     or derived from cursorDiameter if omitted — see App.vue's
//     brushDabSpacing) along the newest segment since the last move — dabs
//     accumulate into the runner's strokeCanvas (never cleared mid-stroke)
//     rather than replaying from a clean snapshot, which is what makes
//     Flow's "repeated passes build up coverage" behaviour work. Every
//     core brush below uses this mode now.
//
// Either way, the plugin function must NOT touch ctx.globalCompositeOperation
// — that's owned by the runner (see `blend` below) so masking and
// destination-out (erasing) work identically for every plugin without each
// one having to reimplement the masked/unmasked split.
//
// `blend`: 'source-over' (default, omit it) | 'destination-out' — how the
// plugin's marks get applied to the layer. An eraser sets this to
// 'destination-out' and just draws opaque coverage marks (color is
// irrelevant under destination-out, only alpha/shape matters); everything
// else uses the default.
//
// Settings passed to paint()/stamp(): { color, lineWidth, hardness, opacity,
// flow }. `opacity` is a stroke-wide CEILING applied once by the runner
// (compositeStroke in App.vue) — plugins should generally never read it.
// `flow` is the per-dab/per-pass "how much ink lands this pass" alpha —
// this is what a plugin should use for its own alpha, and is pre-applied
// as ctx.globalAlpha by the runner before paint()/stamp() is even called,
// so most plugins (see pen/brush/eraser below) don't need to touch alpha
// at all; a plugin only sets ctx.globalAlpha itself when it wants to
// modulate flow further per-dab (see airbrush's per-dot randomisation).
//
// `comp`/`labelKey`/`key` match the existing `tools` array's field names in
// App.vue (not the `icon`/`label` convention used by widget plugins) since
// these plugins are consumed by the same toolbar/tool-popup templates that
// already expect those fields.
//
// `core: true` marks pen/brush/eraser as always-on: the plugin manager
// can't disable them and doesn't even list them — they're baseline tools
// that happen to be implemented as brush plugins for the sake of sharing
// the stroke runner (masking, erasing, etc.), not optional extras. Leave
// `core` unset on anything meant to be a genuinely toggleable add-on, like
// airbrush below.
//
// `defaults: { size, hardness, opacity, flow }`: seeds this brush's own
// independent settings the first time it's selected (see App.vue's
// ensureBrushToolSettings) — every brush remembers its own values
// thereafter, so switching tools shows each one's own last-used settings
// rather than one value shared across all of them.
//
// `cursorDiameter(lineWidth)`: the on-canvas footprint (logical px, before
// fitScale) of a single dab at the given lineWidth — used both to size the
// hover cursor circle (App.vue's brushCursorDiameter) and, when
// stampSpacing is omitted, to derive dab spacing (brushDabSpacing). Size
// now directly means diameter for every core brush (no hidden per-brush
// multiplier) — brushes differ by their *default* size instead — so this
// is the identity function for pen/brush/eraser; only omit it entirely if
// a plugin draws at exactly lineWidth with no adjustment at all.

// ── Shared soft/hard round tip, cached by (diameter, hardness, color) ──
// hardness=100 stays fully opaque almost to the tip's very edge (crisp);
// hardness=0 starts fading from the centre (soft). This is what makes
// Hardness a real, visible parameter for every brush below instead of each
// one hardcoding its own edge softness.
const _tipCache = new Map()
const TIP_CACHE_LIMIT = 100

function getColoredTip(diameter, hardness, color) {
  const d = Math.max(1, Math.round(diameter))
  const h = Math.max(0, Math.min(100, Math.round(hardness)))
  const key = `${d}|${h}|${color}`
  const cached = _tipCache.get(key)
  if (cached) return cached

  const r = d / 2
  const mask = document.createElement('canvas')
  mask.width = d; mask.height = d
  const mg = mask.getContext('2d')
  const grad = mg.createRadialGradient(r, r, 0, r, r, r)
  const innerStop = Math.min(0.98, h / 100)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(innerStop, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  mg.fillStyle = grad
  mg.beginPath(); mg.arc(r, r, r, 0, Math.PI * 2); mg.fill()

  const tip = document.createElement('canvas')
  tip.width = d; tip.height = d
  const tg = tip.getContext('2d')
  tg.fillStyle = color
  tg.fillRect(0, 0, d, d)
  tg.globalCompositeOperation = 'destination-in'
  tg.drawImage(mask, 0, 0)

  if (_tipCache.size >= TIP_CACHE_LIMIT) _tipCache.delete(_tipCache.keys().next().value)
  _tipCache.set(key, tip)
  return tip
}

// Draws one dab of the shared round tip at `point`. Doesn't touch
// ctx.globalAlpha — the runner has already set it to settings.flow.
function stampTip(ctx, point, diameter, hardness, color) {
  const tip = getColoredTip(diameter, hardness, color)
  ctx.drawImage(tip, point.x - diameter / 2, point.y - diameter / 2)
}

registerPlugin({
  id: 'pen', type: 'brush', labelKey: 'tool_pen', comp: Pencil, key: 'P',
  core: true,
  mode: 'stamp',
  defaults: { size: 4, hardness: 100, opacity: 100, flow: 100 },
  cursorDiameter: (lineWidth) => lineWidth,
  stamp(ctx, point, settings) {
    stampTip(ctx, point, settings.lineWidth, settings.hardness, settings.color)
  },
})

registerPlugin({
  id: 'brush', type: 'brush', labelKey: 'tool_brush', comp: Brush, key: 'B',
  core: true,
  mode: 'stamp',
  defaults: { size: 24, hardness: 30, opacity: 100, flow: 45 },
  cursorDiameter: (lineWidth) => lineWidth,
  stamp(ctx, point, settings) {
    stampTip(ctx, point, settings.lineWidth, settings.hardness, settings.color)
  },
})

registerPlugin({
  id: 'eraser', type: 'brush', labelKey: 'tool_eraser', comp: Eraser, key: 'E',
  core: true,
  mode: 'stamp',
  blend: 'destination-out',
  defaults: { size: 20, hardness: 75, opacity: 100, flow: 100 },
  cursorDiameter: (lineWidth) => lineWidth,
  stamp(ctx, point, settings) {
    // Only alpha/shape matter under destination-out — colour is irrelevant,
    // fixed so every eraser dab shares one tip-cache entry regardless of
    // the currently-picked draw colour.
    stampTip(ctx, point, settings.lineWidth, settings.hardness, '#000000')
  },
})

// Proof-of-concept second brush "need": a stamp-mode plugin that scatters
// random dabs instead of tracing a uniform-width path — demonstrates the
// registry supports fundamentally different rendering strategies, not just
// re-skins of the same stroke. Its own per-dot alpha modulates `flow` (the
// per-pass baseline the runner pre-sets), not `opacity` (the stroke-wide
// ceiling — see this file's top comment).
registerPlugin({
  id: 'airbrush', type: 'brush', labelKey: 'tool_airbrush', comp: SprayCan, key: 'A',
  mode: 'stamp',
  stampSpacing: 4,
  defaults: { size: 36, hardness: 10, opacity: 100, flow: 20 },
  cursorDiameter: (lineWidth) => Math.max(6, lineWidth),
  stamp(ctx, point, settings) {
    const r = Math.max(3, settings.lineWidth / 2)
    const baseAlpha = ctx.globalAlpha
    ctx.fillStyle = settings.color
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist  = Math.random() * r
      const x = point.x + Math.cos(angle) * dist
      const y = point.y + Math.sin(angle) * dist
      const dotR = Math.max(0.4, r * 0.06 * (0.5 + Math.random()))
      ctx.globalAlpha = baseAlpha * 0.6 * (0.4 + Math.random())
      ctx.beginPath()
      ctx.arc(x, y, dotR, 0, Math.PI * 2)
      ctx.fill()
    }
  },
})
