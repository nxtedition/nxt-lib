const balanced = require('balanced-match')
const moment = require('moment')
const rx = require('rxjs/operators')
const Observable = require('rxjs')
const JSON6 = require('json-6')
const get = require('lodash/get')
const isPlainObject = require('lodash/isPlainObject')
const fromPairs = require('lodash/fromPairs')
const flatten = require('lodash/fp/flatten')
const capitalize = require('lodash/capitalize')
const startCase = require('lodash/startCase')
const uniq = require('lodash/uniq')
const words = require('lodash/words')

module.exports.onResolveTemplate = onResolveTemplate

module.exports.resolveTemplate = async function (template, context, options) {
  return onResolveTemplate(template, context, options)
    .pipe(
      rx.first()
    )
    .toPromise()
}

// TODO (perf): Optimize.
// TODO (fix): Error handling.
function onResolveTemplate (template, context, options) {
  const match = balanced('{{', '}}', template)
  if (!match) {
    return Observable.of(template)
  }

  const { pre, body, post } = match

  return onResolveTemplate(body, context, options)
    .pipe(
      rx.switchMap(expr => onParseExpression(expr, context, options)),
      rx.map(value => Array.isArray(value) || isPlainObject(value)
        ? JSON.stringify(value)
        : value || ''
      ),
      rx.map(value => `${pre}${value}${post}`),
      rx.switchMap(template => onResolveTemplate(template, context, options))
    )
}

function onParseExpression (expression, context, options) {
  const ds = options ? options.ds : null

  // DOCS inspiration; http://jinja.pocoo.org/docs/2.10/templates/#builtin-filters
  const FILTERS = {
    // undefined
    default: (fallback) => value => Observable.of(value === undefined ? fallback : value),
    // any
    boolean: () => value => Observable.of(Boolean(value)),
    string: () => value => Observable.of(String(value)),
    array: () => value => Observable.of([value]),
    tojson: (indent) => value => Observable.of(JSON.stringify(value, null, indent)),
    // number
    lt: (x) => value => Observable.of(value < x),
    lte: (x) => value => Observable.of(value <= x),
    gt: (x) => value => Observable.of(value > x),
    gte: (x) => value => Observable.of(value >= x),
    int: (fallback, radix) => value => Observable.of(parseInt(value, radix) || fallback),
    float: (fallback) => value => Observable.of(parseFloat(value) || fallback),
    mul: (x) => value => Observable.of(x * value),
    div: (x) => value => Observable.of(x / value),
    mod: (x) => value => Observable.of(x % value),
    add: (x) => value => Observable.of(x + value),
    sub: (x) => value => Observable.of(x - value),
    abs: () => value => Observable.of(Math.abs(value)),
    max: (...args) => value => Observable.of(Array.isArray(value)
      ? Math.max(...value, ...args)
      : Math.max(value, ...args)),
    min: (...args) => value => Observable.of(Array.isArray(value)
      ? Math.min(...value, ...args)
      : Math.min(value, ...args)),
    round: () => value => Observable.of(Math.round(value)),
    // date
    moment: (format) => value => Observable.of(moment(value).format(format)),
    // string
    append: (post) => value => Observable.of(String(value) + post),
    prepend: (pre) => value => Observable.of(pre + String(value)),
    ds: () => value => ds ? ds.record.observe(value) : Observable.of(null),
    lower: () => value => Observable.of(String(value).toLowerCase()),
    upper: () => value => Observable.of(String(value).toUpperCase()),
    capitalize: () => value => Observable.of(capitalize(String(value))),
    title: () => value => Observable.of(startCase(String(value))),
    replace: (a, b) => value => Observable.of(String(value).replace(a, b)),
    trim: () => value => Observable.of(String(value).trim()),
    trimLeft: () => value => Observable.of(String(value).trimLeft()),
    trimRight: () => value => Observable.of(String(value).trimRight()),
    truncate: (length = 255, killwords = false, end = '...', leeway = 0) => value => {
      const s = String(value)

      if (length < end.length) {
        length = end.length
      }

      if (leeway < 0) {
        leeway = 0
      }

      if (s.length <= length + leeway) {
        return Observable.of(s)
      }

      if (killwords) {
        return Observable.of(s.slice(0, length - end.length) + end)
      }

      return Observable.of(s
        .slice(0, length - end.length)
        .trimRight()
        .split(' ')
        .slice(0, -1)
        .join(' ') + end
      )
    },
    wordcount: () => value => Observable.of(words(String(value)).length),
    // array
    slice: (start, end) => value => Observable.of(Array.isArray(value) ? value.slice(start, end) : null),
    reverse: () => value => Observable.of(Array.isArray(value) ? [...value].reverse() : null),
    join: (delimiter) => value => Observable.of(Array.isArray(value)
      ? value.join(delimiter)
      : null),
    first: () => value => Observable.of(Array.isArray(value) ? value[0] : null),
    last: () => value => Observable.of(Array.isArray(value) && value.length > 0
      ? value[value.length - 1]
      : null),
    length: () => value => Observable.of(Array.isArray(value) ? value.length : 0),
    sort: () => value => Observable.of(Array.isArray(value) ? [...value].sort() : null),
    sum: () => value => Observable.of(Array.isArray(value) ? value.reduce((a, b) => a + b, 0) : 0),
    unique: () => value => Observable.of(Array.isArray(value) ? uniq(value) : null),
    // collection
    pluck: (path) => value => Observable.of(get(value, path)),
    map: (f, ...args) => value => {
      const filter = f && FILTERS[f]

      if (!filter) {
        return Observable.of(value)
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          return Observable.of([])
        }

        return Observable.combineLatest(value.map(x => filter(...args)(x)))
      }

      // like lodash mapValues
      if (isPlainObject(value)) {
        const entries = Object.entries(value)

        if (entries.length === 0) {
          return Observable.of({})
        }

        const pair$s = entries.map(([k, v]) => filter(...args)(v).pipe(
          rx.map(x => [k, x])
        ))

        return Observable.combineLatest(pair$s).pipe(rx.map(fromPairs))
      }

      return Observable.of(value)
    },
    select: (f, ...args) => value => {
      const filter = f ? FILTERS[f] : FILTERS.boolean

      if (!filter) {
        throw new Error(`unexpected filter in select(): ${f}`)
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          return Observable.of([])
        }

        return Observable
          .combineLatest(value.map(x => filter(...args)(x).pipe(
            rx.map(ok => ok ? [x] : [])
          ))).pipe(
            rx.map(flatten)
          )
      }

      // like lodash pickBy
      if (isPlainObject(value)) {
        const entries = Object.entries(value)

        if (entries.length === 0) {
          return Observable.of({})
        }

        const pair$s = entries.map(([k, v]) => filter(...args)(v).pipe(
          rx.map(ok => ok ? [k, v] : [])
        ))

        return Observable.combineLatest(pair$s).pipe(
          rx.map(fromPairs)
        )
      }

      return Observable.of(value)
    }
  }

  const [ basePath, ...filters ] = expression.split(/\s*\|\s*/)
  const baseValue = get(context, basePath.trim())

  return filters
    .map(filter => filter.match(/([^(]+)\((.*)\)/) || [])
    .reduce((value$, [ , name, argsStr ]) => value$
      .pipe(
        rx.switchMap(value => {
          const filter = FILTERS[name]

          if (!filter) {
            return Observable.of(value)
          }

          const args = argsStr
            .split(/\s*,\s*/)
            .map(argStr => {
              try {
                return JSON6.parse(argStr)
              } catch (err) {
                return err.message // TODO improve
              }
            })

          return filter(...args)(value)
        })
      ), Observable.of(baseValue)
    )
}
