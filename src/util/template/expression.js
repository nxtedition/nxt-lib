const moment = require('moment-timezone')
const rx = require('rxjs/operators')
const Observable = require('rxjs')
const JSON5 = require('json5')
const fp = require('lodash/fp')
const memoize = require('memoizee')
const NestedError = require('nested-error-stacks')
const hasha = require('hasha')
const split = require('split-string')
const xuid = require('xuid')

const RETURN = {}

function asFilter (transform, predicate, obj) {
  return fp.mapValues(factory => (...args) => {
    const filter = factory(...args)
    return value => {
      try {
        value = transform ? transform(value) : value
        return !predicate || predicate(value) ? filter(value) : null
      } catch (err) {
        return null
      }
    }
  }, obj)
}

module.exports = ({ ds } = {}) => {
  const FILTERS = {
    // any
    ...asFilter(
      null,
      null,
      {
        boolean: () => value => Boolean(value),
        toJSON: (indent) => value => JSON.stringify(value, null, indent),
        toJSON5: () => value => JSON5.stringify(value),
        json: (indent) => value => JSON.stringify(value, null, indent),
        json5: () => value => JSON5.stringify(value),
        string: () => value => String(value),
        number: () => value => Number(value),
        date: (tz) => value => tz ? moment.tz(value, tz) : moment(value),
        array: () => value => [value],
        value: value => () => value,
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
        not: () => value => !value,
        and: (x) => value => x && value,
        or: (x) => value => x || value,
        isDate: () => value => value instanceof Date,
        isArray: () => value => Array.isArray(value),
        isEqual: (x) => value => fp.isEqual(value, x),
        isNil: () => value => value == null,
        isNumber: () => value => Number.isFinite(value),
        isString: () => value => fp.isString(value),
        ternary: (a, b) => value => value ? a : b,
        cond: (a, b) => value => value ? a : b,
        hasha: (options) => value => hasha(JSON.stringify(value), options || {}),
        hashaint: (options) => value => parseInt(hasha(JSON.stringify(value), options || {}).slice(-13), 16),
        return: () => value => value || RETURN,
        add: (...args) => value => {
          if (args.length === 2) {
            value = moment(value)
            return value.isValid() ? value.add(...args) : null
          } else {
            value = Number(value)
            return Number.isFinite(value) ? value + args[0] : null
          }
        },
        sub: (...args) => value => {
          if (args.length === 2) {
            value = moment(value)
            return value.isValid() ? value.subtract(...args) : null
          } else {
            value = Number(value)
            return Number.isFinite(value) ? value - args[0] : null
          }
        }
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
        mul: (x) => value => value * x,
        div: (x) => value => value / x,
        mod: (x) => value => value % x,
        abs: () => value => Math.abs(value),
        round: () => value => Math.round(value),
        floor: () => value => Math.floor(value),
        ceil: () => value => Math.ceil(value),
        clamp: (min, max) => value => Math.max(min, Math.min(max, value))
      }
    ),
    ...asFilter(
      value => (Array.isArray(value) ? value : [value]).map(x => Number(x)).filter(x => Number.isFinite(x)),
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
        moment: (format, tz) => {
          // TODO (fix): Validate arguments...
          return value => {
            if (tz) {
              value = value.tz(tz)
            }
            return value.format(format)
          }
        },
        startOf: (startOf) => {
          // TODO (fix): Validate arguments...
          return value => value.startOf(startOf)
        },
        endOf: (endOf) => {
          // TODO (fix): Validate arguments...
          return value => value.endOf(endOf)
        }
      }
    ),
    // ds
    ...asFilter(
      null,
      value => value && (typeof value === 'string' || Array.isArray(value)),
      {
        ds: (postfix, path, state = ds.record.SERVER) => {
          // TODO (fix): Validate arguments...
          if (!ds) {
            throw new Error('invalid argument')
          }

          function observe (id) {
            return ds.record.observe((id || '') + (postfix || ''), path, state)
          }

          return value => {
            if (value && fp.isString(value)) {
              return observe(value)
            }

            if (Array.isArray(value)) {
              value = value.filter(x => x && fp.isString(x))
              if (value.length) {
                return Observable.combineLatest(value.map(id => observe(id)))
              }
            }

            return null
          }
        }
      }
    ),
    // string
    ...asFilter(
      value => value == null || fp.isPlainObject(value) || Array.isArray(value) ? '' : String(value),
      value => typeof value === 'string',
      {
        fromJSON: () => value => value ? JSON.parse(value) : null,
        fromJSON5: () => value => value ? JSON5.parse(value) : null,
        toSlate: () => value => ({
          object: 'value',
          document: {
            object: 'document',
            data: {},
            nodes: value
              .split('\n')
              .map(line => ({
                object: 'block',
                type: 'paragraph',
                data: {},
                nodes: [{
                  object: 'text',
                  leaves: [{
                    object: 'leaf',
                    text: line,
                    marks: []
                  }],
                  // TODO: make these deterministic
                  key: xuid()
                }],
                key: xuid()
              })),
            key: xuid()
          }
        }),
        append: (post) => value => value + post,
        prepend: (pre) => value => pre + value,
        asset: (type, _return = true) => {
          // TODO (fix): Validate arguments...
          if (!ds) {
            throw new Error('invalid argument')
          }

          return value => value
            ? ds.record
              .observe(`${value}:asset.rawTypes`, ds.record.SERVER)
              .pipe(
                rx.pluck('value'),
                rx.map(fp.includes(type)),
                rx.distinctUntilChanged(),
                rx.map(isType => isType
                  ? value
                  : _return
                    ? RETURN
                    : null
                )
              )
            : null
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
        capitalize: () => value => fp.capitalize(value),
        split: (delimiter) => value => value.split(delimiter),
        title: () => value => fp.startCase(value),
        replace: (...args) => {
          // TODO (fix): Validate argument count...

          if (args.some(val => typeof val !== 'string')) {
            throw new Error('invalid argument')
          }

          if (args.length === 3) {
            const [pattern, flags, str] = args
            const expr = new RegExp(pattern, flags)
            return value => value.replace(expr, str)
          } else if (args.length === 2) {
            const [a, b] = args
            return value => value.replace(a, b)
          } else {
            throw new Error('invalid argument')
          }
        },
        padStart: (...args) => value => value.padStart(...args),
        padEnd: (...args) => value => value.padEnd(...args),
        charAt: (...args) => value => value.charAt(...args),
        startsWith: (...args) => value => value.startsWith(...args),
        endsWith: (...args) => value => value.endsWith(...args),
        substring: (...args) => value => value.substring(...args),
        slice: (...args) => value => value.slice(...args),
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
        wordcount: () => value => fp.words(value).length,
        words: () => value => fp.words(value)
      }
    ),
    ...asFilter(
      value => Array.isArray(value) || typeof value === 'string' ? value : [],
      value => value.includes,
      {
        includes: (...args) => value => value.includes(...args)
      }
    ),
    // array
    ...asFilter(
      value => Array.isArray(value) ? value : [],
      value => Array.isArray(value),
      {
        map: (path) => value => fp.isArray(path) ? fp.map(fp.pick(path), value) : fp.map(fp.get(path), value),
        slice: (start, end) => value => value.slice(start, end),
        reverse: () => value => fp.reverse(value),
        join: (delimiter) => value => fp.join(delimiter, value),
        at: (index) => value => value[index],
        first: () => value => fp.head(value),
        head: () => value => fp.head(value),
        last: () => value => fp.last(value),
        tail: () => value => fp.last(value),
        length: () => value => value.length,
        sort: () => value => [...value].sort(),
        sum: () => value => fp.sum(value),
        unique: () => value => fp.uniq(value),
        uniq: () => value => fp.uniq(value),
        flatten: (depth = 1) => value => fp.flattenDepth(depth, value),
        flattenDeep: () => value => fp.flattenDeep(value),
        union: (...args) => value => fp.union(args[0], value),
        intersection: (...args) => value => fp.intersection(args[0], value),
        concat: (...args) => value => fp.concat(value, args[0]),
        difference: (...args) => value => fp.difference(value, args[0]),
        initial: () => value => fp.initial(value),
        compact: () => value => fp.compact(value),
        pull: (...args) => value => fp.pull(args[0], value)
      }
    ),
    // collection
    ...asFilter(
      value => Array.isArray(value) || fp.isPlainObject(value) ? value : [],
      value => Array.isArray(value) || fp.isPlainObject(value),
      {
        pluck: (path) => value => fp.get(path, value),
        get: (path) => value => fp.get(path, value),
        values: () => value => fp.values(value),
        keys: () => value => fp.keys(value),
        size: () => value => fp.size(value),
        entries: () => value => fp.entries(value)
      }
    )
  }

  const getFilter = memoize((filterStr) => {
    const [, filterName, argsStr] = filterStr
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .match(/([^(]+)\((.*)\)/) || []

    const tokens = split(argsStr, {
      separator: ',',
      brackets: true,
      quotes: ['"']
    })

    const args = tokens
      .map(x => {
        try {
          return x ? JSON5.parse(x) : x
        } catch (err) {
          throw new NestedError(`failed to parse token ${x}`, err)
        }
      })

    const factory = FILTERS[filterName]

    if (!factory) {
      throw new Error(`unknown filter: ${filterName}`)
    }

    return factory(...args)
  }, {
    max: 1024,
    primitive: true
  })

  return memoize(expression => {
    try {
      const [basePath, ...tokens] = split(expression, {
        separator: '|',
        quotes: ['"']
      }).map(str => str.trim())

      const get = (value, [path, ...rest]) => {
        if (!path || !value || typeof value !== 'object') {
          return Observable.isObservable(value)
            ? value
            : Observable.of(value)
        } else {
          return Observable.isObservable(value)
            ? value.pipe(rx.switchMap(value => get(value[path], rest)))
            : get(value[path], rest)
        }
      }

      const filters = tokens.map(getFilter)

      return context => {
        function reduce (value, index) {
          if (value === RETURN) {
            return Observable.of(null)
          }

          while (index < filters.length) {
            value = filters[index++](value)

            if (value === RETURN) {
              return Observable.of(null)
            }

            if (Observable.isObservable(value)) {
              return value
                .pipe(
                  rx.switchMap(value => reduce(value, index)),
                  // TODO (fix): better error handling...
                  rx.catchError(() => Observable.of(null))
                )
            }
          }

          return Observable.of(value)
        }

        return get(context, fp.toPath(basePath))
          .pipe(
            rx.switchMap(value => reduce(value, 0)),
            // TODO (fix): better error handling...
            rx.catchError(() => Observable.of(null))
          )
      }
    } catch (err) {
      throw new NestedError(`failed to parse expression ${expression}`, err)
    }
  }, {
    max: 1024,
    primitive: true
  })
}
