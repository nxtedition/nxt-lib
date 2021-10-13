const { Observable } = require('rxjs')
const fp = require('lodash/fp')

module.exports = { encodeASS }

// TODO move referencedStyles out as argument, like with subtitleEvents.
// We need "hardcoded" styles snapshots to be passed in as well.
function encodeASS(ds, subtitleEvents) {
  if (subtitleEvents.length === 0) {
    return Observable.of({})
  }

  const referencedStyles$ = Observable.combineLatest(
    ...fp.pipe(
      fp.map(fp.prop('style')),
      fp.uniq,
      fp.map((id) =>
        ds.record
          .observe(`${id}:subtitle-style`)
          .map((style) => (fp.isEmpty(style) ? {} : { [id]: style }))
      )
    )(subtitleEvents)
  ).map((xs) => (xs.length ? fp.mergeAll(xs) : {}))

  const input$ = Observable.combineLatest(referencedStyles$, getDefaultStyle(ds)).map(
    ([styles, defaultStyle]) => {
      const extraStyles = {}

      const events = subtitleEvents.map((event) => {
        const change = {}

        if (!event.end) {
          // NOTE: :subtitle uses `end`, :event uses `duration`
          change.end = event.duration != null ? event.start + event.duration : null
        }

        if (!styles[event.style]) {
          extraStyles['nxt-default'] = defaultStyle
          change.style = 'nxt-default'
        }

        return { ...event, ...change }
      })

      return { events, styles: { ...styles, ...extraStyles } }
    }
  )

  return input$.map(({ styles, events }) => {
    const value = [
      encASSHeader(), // TODO { width, height }?
      encASSStyles(styles),
      encASSEvents(events),
    ].join('\n')

    return { value, styles, events }
  })
}

function getDefaultStyle(ds) {
  return ds.record.observe('nxt-default:subtitle-style').map((style) =>
    !fp.isEmpty(style)
      ? style
      : {
          name: 'nxt-default',
          fontname: 'FreeSans',
          fontsize: '72',
          primaryColour: '&H00FFFFFF',
          secondaryColour: '&H000000FF',
          outlineColour: '&H80000000',
          backColour: '&H0',
          bold: '0',
          italic: '0',
          underline: '0',
          strikeOut: '0',
          scaleX: '100',
          scaleY: '100',
          spacing: '0',
          angle: '0',
          borderStyle: '3',
          outline: '0.001',
          shadow: '0',
          alignment: '1',
          marginL: '60',
          marginR: '60',
          marginV: '60',
          encoding: '1',
        }
  )
}

const formatDialogues = fp.pipe(
  fp.filter(fp.conformsTo({ start: fp.isNumber })),
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
