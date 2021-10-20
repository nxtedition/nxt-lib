const fp = require('lodash/fp')

module.exports = { encodeASS }

// TODO move referencedStyles out as argument, like with subtitleEvents.
// We need "hardcoded" styles snapshots to be passed in as well.
function encodeASS(events, { styles = {}, ...options } = {}) {
  return [
    encASSHeader(options),
    encASSStyles(styles),
    encASSEvents(
      events.map((event) => {
        // NOTE: :subtitle uses `end`, :event uses `duration`
        if (event.end == null) {
          return { ...event, end: event.duration != null ? event.start + event.duration : null }
        }
        return event
      })
    ),
  ].join('\n')
}

const formatDialogues = fp.pipe(
  fp.filter(fp.conformsTo({ start: fp.isFinite })),
  fp.sortBy('start'),
  fp.reduce((s, event) => {
    const { start, end, text, style } = event
    return (
      s +
      `Dialogue: 0,${formatASSTime(start) || '0:00:00.00'},${formatASSTime(end) || '9:59:59.00'},${
        style || 'nxt-default'
      },,0000,0000,0000,,${(text || '').replace(/\\n|\n/, '\\N')}\n`
    )
  }, '')
)

function encASSEvents(events) {
  return `[Events]
  Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
  ${formatDialogues(events)}`
}

const formatStyles = fp.pipe(
  fp.entries,
  fp.reduce((s, [id, style]) => {
    return (
      s +
      'Style: ' +
      id +
      ',' +
      style.fontname +
      ',' +
      style.fontsize +
      ',' +
      style.primaryColour +
      ',' +
      style.secondaryColour +
      ',' +
      style.outlineColour +
      ',' +
      style.backColour +
      ',' +
      style.bold +
      ',' +
      style.italic +
      ',' +
      style.underline +
      ',' +
      style.strikeOut +
      ',' +
      style.scaleX +
      ',' +
      style.scaleY +
      ',' +
      style.spacing +
      ',' +
      style.angle +
      ',' +
      style.borderStyle +
      ',' +
      style.outline +
      ',' +
      style.shadow +
      ',' +
      style.alignment +
      ',' +
      style.marginL +
      ',' +
      style.marginR +
      ',' +
      style.marginV +
      ',' +
      style.encoding +
      '\n'
    )
  }, '')
)

function encASSStyles(styles) {
  return `[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${formatStyles(styles)}`
}

function encASSHeader({ width, height } = {}) {
  // WrapStyle
  // 0: smart wrapping, lines are evenly broken
  // 1: end-of-line word wrapping, only \N breaks
  // 2: no word wrapping, \n \N both breaks
  // 3: same as 0, but lower line gets wider.
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width || 1920}
PlayResY: ${height || 1080}
WrapStyle: 1
`
}

function pad0(rep, x) {
  return String(x || 0).padStart(rep, '0')
}

function formatASSTime(seconds) {
  if (seconds == null) {
    return ''
  }
  const h = Math.floor(seconds / 3.6e3)
  seconds -= h * 3.6e3
  const m = Math.floor(seconds / 60)
  seconds -= m * 60
  const s = Math.floor(seconds)
  const cs = Math.floor((seconds - s) * 100)
  return `${pad0(1, h)}:${pad0(2, m)}:${pad0(2, s)}.${pad0(2, cs)}`
}
