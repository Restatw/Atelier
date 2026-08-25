import { Pencil, Brush, Eraser, SprayCan } from 'lucide-vue-next'
import { registerPlugin } from '../registry.js'

// Brush plugin shape:
//   mode: 'path' | 'stamp'
//   - 'path' plugins implement paint(ctx, points, settings) and get called
//     once per animation frame with the FULL point list of the stroke so
//     far — the runner always restores a clean layer snapshot first, so
//     paint() should draw the whole path as if for the first time. Good
//     for ink-like strokes with a uniform width/opacity along their length.
//   - 'stamp' plugins implement stamp(ctx, point, settings) and get called
//     once per interpolated dab position (spaced `stampSpacing` px apart)
//     along the newest segment since the last move — dabs accumulate
//     directly rather than replaying from a clean snapshot. Good for
//     effects meant to build up density under a lingering cursor.
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

function strokePoly(ctx, points) {
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.stroke()
}

registerPlugin({
  id: 'pen', type: 'brush', labelKey: 'tool_pen', comp: Pencil, key: 'P',
  core: true,
  mode: 'path',
  paint(ctx, points, settings) {
    ctx.globalAlpha = settings.opacity
    ctx.strokeStyle = settings.color
    ctx.lineWidth   = settings.lineWidth
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    strokePoly(ctx, points)
  },
})

registerPlugin({
  id: 'brush', type: 'brush', labelKey: 'tool_brush', comp: Brush, key: 'B',
  core: true,
  mode: 'path',
  paint(ctx, points, settings) {
    ctx.globalAlpha = settings.opacity * 0.4
    ctx.strokeStyle = settings.color
    ctx.lineWidth   = settings.lineWidth * 3
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    strokePoly(ctx, points)
  },
})

registerPlugin({
  id: 'eraser', type: 'brush', labelKey: 'tool_eraser', comp: Eraser, key: 'E',
  core: true,
  mode: 'path',
  blend: 'destination-out',
  paint(ctx, points, settings) {
    // Only alpha/shape matter under destination-out — color is irrelevant,
    // and unlike every other brush an eraser always erases at full
    // strength regardless of the opacity slider.
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#000000'
    ctx.lineWidth   = settings.lineWidth * 3
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    strokePoly(ctx, points)
  },
})

// Proof-of-concept second brush "need": a stamp-mode plugin that scatters
// random dabs instead of tracing a uniform-width path — demonstrates the
// registry supports fundamentally different rendering strategies, not just
// re-skins of the same stroke.
registerPlugin({
  id: 'airbrush', type: 'brush', labelKey: 'tool_airbrush', comp: SprayCan, key: 'A',
  mode: 'stamp',
  stampSpacing: 4,
  stamp(ctx, point, settings) {
    const r = Math.max(4, settings.lineWidth * 2.2)
    ctx.fillStyle = settings.color
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist  = Math.random() * r
      const x = point.x + Math.cos(angle) * dist
      const y = point.y + Math.sin(angle) * dist
      const dotR = Math.max(0.4, r * 0.06 * (0.5 + Math.random()))
      ctx.globalAlpha = settings.opacity * 0.12 * (0.4 + Math.random())
      ctx.beginPath()
      ctx.arc(x, y, dotR, 0, Math.PI * 2)
      ctx.fill()
    }
  },
})
