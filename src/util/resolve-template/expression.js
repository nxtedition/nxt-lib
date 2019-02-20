const moment = require('moment')
const rx = require('rxjs/operators')
const Observable = require('rxjs')
const JSON5 = require('json5')
const get = require('lodash/get')
const isEqual = require('lodash/isEqual')
const isPlainObject = require('lodash/isPlainObject')
const isString = require('lodash/isString')
const flattenDepth = require('lodash/fp/flattenDepth')
const flattenDeep = require('lodash/fp/flattenDeep')
const capitalize = require('lodash/capitalize')
const startCase = require('lodash/startCase')
const uniq = require('lodash/uniq')
const mapValues = require('lodash/mapValues')
const words = require('lodash/words')
const memoize = require('memoizee')

function asFilter (transform, predicate, obj) {
  return mapValues(obj, (factory) => (...args) => {
    const filter = factory(...args)
    return value => {
      try {
        value = transform ? transform(value) : value
        return !predicate || predicate(value) ? filter(value) : null
      } catch (err) {
        return null
      }
    }
  })
}

module.exports = memoize((ds) => {
  const FILTERS = {
    // any
    ...asFilter(
      null,
      null,
      {
        boolean: () => value => Boolean(value),
        tojson: (indent) => value => JSON.stringify(value, null, indent),
        tojson5: () => value => JSON5.stringify(value),
        string: () => value => String(value),
        number: () => value => Number(value),
        date: (...args) => value => moment(value, ...args),
        array: () => value => [ value ],
        int: (fallback = null, radix) => value => {
          // TODO (fix): Validate arguments...

          const int = parseInt(value, radix)
          return Number.isFinite(int) ? int : fallback
        },
        float: (fallback = null) => value => {
          // TODO (fix): Validate arguments...

          const float = parseFloat(value)
          return Number.isFinite(float) ? float : fallback
        },
        default: (defaultValue, notJustNully) => value =>
          notJustNully
            ? (!value ? defaultValue : value)
            : (value == null ? defaultValue : value),
        eq: (x) => value => value === x,
        ne: (x) => value => value !== x,
        isDate: () => value => value instanceof Date,
        isArray: () => value => Array.isArray(value),
        isEqual: (x) => value => isEqual(value, x),
        isNil: () => value => value == null,
        isNumber: () => value => Number.isFinite(value),
        isString: () => value => isString(value),
        ternary: (a, b) => value => value ? a : b
      }
    ),
    // number
    ...asFilter(
      value => Number(value),
      value => Number.isFinite(value),
      {
        le: (x) => value => value <= x,
        lt: (x) => value => value < x,
        ge: (x) => value => value >= x,
        gt: (x) => value => value > x,
        mul: (x) => value => x * value,
        div: (x) => value => x / value,
        mod: (x) => value => x % value,
        add: (x) => value => x + value,
        sub: (x) => value => x - value,
        abs: () => value => Math.abs(value),
        round: () => value => Math.round(value),
        floor: () => value => Math.floor(value),
        ceil: () => value => Math.ceil(value)
      }
    ),
    ...asFilter(
      value => (Array.isArray(value) ? value : [ value ]).map(x => Number(x)).filter(x => Number.isFinite(x)),
      value => value.every(x => Number.isFinite(x)),
      {
        min: (...args) => value => Math.min(...value, ...args),
        max: (...args) => value => Math.max(...value, ...args)
      }
    ),
    // date
    ...asFilter(
      value => moment(value),
      value => value.isValid(),
      {
        moment: (...args) => {
          // TODO (fix): Validate arguments...

          return value => value.format(...args)
        }
      }
    ),
    // string
    ...asFilter(
      value => value == null || isPlainObject(value) || Array.isArray(value) ? '' : String(value),
      value => typeof value === 'string',
      {
        fromjson: () => value => JSON.parse(value),
        fromjson5: () => value => JSON5.parse(value),
        append: (post) => value => value + post,
        prepend: (pre) => value => pre + value,
        ds: (name, path) => {
          // TODO (fix): Validate arguments...
          if (!ds) {
            throw new Error('invalid argument')
          }

          return value => ds.record
            .observe((value || '') + (name || ''))
            .pipe(
              rx.map(val => path ? get(val, path) : val)
            )
        },
        lower: () => value => value.toLowerCase(),
        upper: () => value => value.toUpperCase(),
        match: (...args) => {
          // TODO (fix): Validate argument count...

          if (args.some(val => typeof val !== 'string')) {
            throw new Error('invalid argument')
          }

          return value => value.match(new RegExp(...args))
        },
        capitalize: () => value => capitalize(value),
        split: (delimiter) => value => value.split(delimiter),
        title: () => value => startCase(value),
        replace: (...args) => {
          // TODO (fix): Validate argument count...

          if (args.some(val => typeof val !== 'string')) {
            throw new Error('invalid argument')
          }

          if (args.length === 3) {
            const [ pattern, flags, str ] = args
            return value => value.replace(new RegExp(pattern, flags), str)
          } else if (args.length === 2) {
            const [ a, b ] = args
            return value => value.replace(a, b)
          } else {
            throw new Error('invalid argument')
          }
        },
        padStart: (...args) => value => value.padStart(...args),
        padEnd: (...args) => value => value.padEnd(...args),
        charAt: (...args) => value => value.charAt(...args),
        startsWith: () => value => value.startsWith(),
        endsWith: () => value => value.endsWith(),
        trim: () => value => value.trim(),
        trimStart: () => value => value.trimStart(),
        trimEnd: () => value => value.trimEnd(),
        trimLeft: () => value => value.trimLeft(),
        trimRight: () => value => value.trimRight(),
        truncate: (length = 255, killwords = false, end = '...', leeway = 0) => value => {
          // TODO (fix): Validate arguments...

          const s = String(value)

          if (length < end.length) {
            length = end.length
          }

          if (leeway < 0) {
            leeway = 0
          }

          if (s.length <= length + leeway) {
            return s
          }

          if (killwords) {
            return s.slice(0, length - end.length) + end
          }

          return s
            .slice(0, length - end.length)
            .trimRight()
            .split(' ')
            .slice(0, -1)
            .join(' ') + end
        },
        wordcount: () => value => Observable.of(words(value).length)
      }
    ),
    ...asFilter(
      value => Array.isArray(value) || typeof value === 'string' ? value : [],
      value => value.includes,
      (...args) => value => value.includes(...args)
    ),
    // array
    ...asFilter(
      value => Array.isArray(value) ? value : [],
      value => Array.isArray(value),
      {
        slice: (start, end) => value => value.slice(start, end),
        reverse: () => value => [ ...value ].reverse(),
        join: (delimiter) => value => value.join(delimiter),
        first: () => value => value[0],
        last: () => value => value[value.length - 1],
        length: () => value => value.length,
        sort: () => value => [ ...value ].sort(),
        sum: () => value => value.reduce((a, b) => a + b, 0),
        unique: () => value => uniq(value),
        uniq: () => value => uniq(value),
        flatten: (depth = 1) => value => flattenDepth(value, depth),
        flattenDeep: () => value => flattenDeep(value)
      }
    ),
    // collection
    ...asFilter(
      value => Array.isArray(value) || isPlainObject(value) ? value : [],
      value => Array.isArray(value) || isPlainObject(value),
      {
        pluck: (path) => value => get(value, path),
        get: (path) => value => get(value, path),
        values: () => value => Object.values(value),
        keys: () => value => Object.keys(value),
        entries: () => value => Object.entries(value)
      }
    )
  }

  const getFilter = memoize(function (filterStr) {
    const [ , filterName, argsStr ] = filterStr.match(/([^(]+)\((.*)\)/) || []

    const tokens = argsStr
      ? argsStr.split(/\s*,\s*/)
      : []

    const args = tokens
      .map(x => x ? JSON5.parse(x) : x)

    const factory = FILTERS[filterName]

    if (!factory) {
      throw new Error(`unexpected filter: ${filterName}`)
    }

    return factory(...args)
  }, {
    max: 1024,
    primitive: true
  })

  return memoize(function (expression) {
    const [ basePath, ...tokens ] = expression.trim().split(/\s*\|\s*/)

    if (tokens.length === 0) {
      return context => Observable.of(get(context, basePath))
    }

    const filters = tokens.map(getFilter)

    return (context) => {
      const baseValue = get(context, basePath)

      function reduce (value, index) {
        while (index < filters.length) {
          value = filters[index++](value)
          if (Observable.isObservable(value)) {
            return value
              .pipe(
                rx.switchMap(value => reduce(value, index)),
                rx.catchError(() => Observable.of(null))
              )
          }
        }
        return Observable.of(value)
      }

      return reduce(baseValue, 0)
    }
  }, {
    max: 1024,
    primitive: true
  })
}, { max: 2 })
