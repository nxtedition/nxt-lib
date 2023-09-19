const fp = require('lodash/fp')

module.exports = { encodeASS }

function encodeASS(events, { styles = {}, width = 1920, height = 1080 } = {}) {
  return [encASSHeader({ width, height }), encASSStyles(styles), encASSEvents(events)].join('\n')
}

function formatDialogues(events) {
  let s = ''
  for (const { start, duration, end = duration != null ? start + duration : null, text, style } of [
    ...events,
  ].sort((a, b) => a.start - b.start)) {
    if (typeof text === 'string' && text.length > 0 && Number.isFinite(start)) {
      s += `Dialogue: 0,${formatASSTime(start) || '0:00:00.00'},${
        formatASSTime(end) || '9:59:59.00'
      },${style || 'nxt-default'},,0000,0000,0000,,${(text || '').replace(/\\n|\n/, '\\N')}\n`
    }
  }
  return s
}

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

function encASSHeader({ width, height }) {
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

function formatASSTime(seconds) {
  if (seconds == null) {
    return ''
  }

  const h = Math.floor(seconds / 3600)
  seconds -= h * 3600
  const m = Math.floor(seconds / 60)
  seconds -= m * 60
  const s = Math.floor(seconds)
  const cs = Math.floor((seconds - s) * 100)

  return (
    h +
    ':' +
    (m === 0 ? '00' : m < 10 ? '0' + m : m) +
    ':' +
    (s === 0 ? '00' : s < 10 ? '0' + s : s) +
    '.' +
    (cs === 0 ? '00' : cs < 10 ? '0' + cs : cs)
  )
}
