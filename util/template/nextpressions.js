import moment from 'moment-timezone'
import * as rxjs from 'rxjs'
import JSON5 from 'json5'
import fp from 'lodash/fp.js'
import NestedError from 'nested-error-stacks'
import { hashSync } from 'hasha'
import split from 'split-string'
import { makeWeakCache } from '../../weakCache.js'

const RETURN = {}

function asFilter(transform, predicate, obj) {
  return fp.mapValues(
    (factory) =>
      (...args) => {
        const filter = factory(...args)
        return (value, options) => {
          try {
            value = transform ? transform(value, options) : value
            return !predicate || predicate(value, options) ? filter(value, options) : null
          } catch (err) {
            return null
          }
        }
      },
    obj,
  )
}

export default function ({ ds } = {}) {
  const FILTERS = {
    // any
    ...asFilter(null, null, {
      boolean: () => (value) => Boolean(value),
      toJSON: (indent) => (value) => JSON.stringify(value, null, indent),
      toJSON5: () => (value) => JSON5.stringify(value),
      json: (indent) => (value) => JSON.stringify(value, null, indent),
      isEmpty: () => (value) => fp.isEmpty(value),
      json5: () => (value) => JSON5.stringify(value),
      string: () => (value) => {
        if (moment.isMoment(value) || moment.isDate(value)) {
          return value.toISOString()
        }
        if (typeof value?.toString() === 'function') {
          return value.toString()
        }
        return String(value)
      },
      number: () => (value) => {
        if (moment.isMoment(value) || moment.isDate(value)) {
          return value.valueOf()
        }
        return Number(value)
      },
      date: (tz) => (value) => (tz ? moment.tz(value, tz) : moment(value)),
      array: () => (value) => [value],
      value: (value) => () => value,
      int:
        (fallback = null, radix) =>
        (value) => {
          // TODO (fix): Validate arguments...

          const int = parseInt(value, radix)
          return Number.isFinite(int) ? int : fallback
        },
      float:
        (fallback = null) =>
        (value) => {
          // TODO (fix): Validate arguments...

          const float = parseFloat(value)
          return Number.isFinite(float) ? float : fallback
        },
      default: (defaultValue, notJustNully) => (value) =>
        notJustNully ? (!value ? defaultValue : value) : value == null ? defaultValue : value,
      else: (x) => (value) => value || x,
      eq: (x) => (value) => value === x,
      ne: (x) => (value) => value !== x,
      not: () => (value) => !value,
      and: (x) => (value) => x && value,
      or: (x) => (value) => x || value,
      isDate: () => (value) => moment.isMoment(value),
      isArray: () => (value) => Array.isArray(value),
      isEqual: (x) => (value) => fp.isEqual(value, x),
      isNil: () => (value) => value == null,
      isNumber: () => (value) => Number.isFinite(value),
      isString: () => (value) => fp.isString(value),
      ternary: (a, b) => (value) => (value ? a : b),
      cond: (a, b) => (value) => (value ? a : b),
      hasha: (options) => (value) => hashSync(JSON.stringify(value), options || {}),
      hashaint: (options) => (value) =>
        parseInt(hashSync(JSON.stringify(value), options || {}).slice(-13), 16),
      return: () => (value) => value || RETURN,
      add:
        (...args) =>
        (value) => {
          if (args.length === 2) {
            value = moment(value)
            return value.isValid() ? value.add(...args) : null
          } else {
            value = Number(value)
            return Number.isFinite(value) ? value + args[0] : null
          }
        },
      sub:
        (...args) =>
        (value) => {
          if (args.length === 2) {
            value = moment(value)
            return value.isValid() ? value.subtract(...args) : null
          } else {
            value = Number(value)
            return Number.isFinite(value) ? value - args[0] : null
          }
        },
    }),
    // number
    ...asFilter(
      (value) => Number(value),
      (value) => Number.isFinite(value),
      {
        le: (x) => (value) => value <= x,
        lt: (x) => (value) => value < x,
        ge: (x) => (value) => value >= x,
        gt: (x) => (value) => value > x,
        mul: (x) => (value) => value * x,
        div: (x) => (value) => value / x,
        mod: (x) => (value) => value % x,
        abs: () => (value) => Math.abs(value),
        round: () => (value) => Math.round(value),
        floor: () => (value) => Math.floor(value),
        ceil: () => (value) => Math.ceil(value),
        clamp: (min, max) => (value) => Math.max(min, Math.min(max, value)),
      },
    ),
    ...asFilter(
      (value) =>
        (Array.isArray(value) ? value : [value])
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x)),
      (value) => value.every((x) => Number.isFinite(x)),
      {
        min:
          (...args) =>
          (value) =>
            Math.min(...value, ...args),
        max:
          (...args) =>
          (value) =>
            Math.max(...value, ...args),
      },
    ),
    // date
    ...asFilter(
      (value) => moment(value),
      (value) => value.isValid(),
      {
        moment: (format, tz) => {
          // TODO (fix): Validate arguments...
          return (value) => {
            if (tz) {
              value = value.tz(tz)
            }
            return format ? value.format(format) : value.toISOString()
          }
        },
        startOf: (startOf) => {
          // TODO (fix): Validate arguments...
          return (value) => value.startOf(startOf)
        },
        endOf: (endOf) => {
          // TODO (fix): Validate arguments...
          return (value) => value.endOf(endOf)
        },
      },
    ),
    // ds
    ...asFilter(null, (value) => value && (typeof value === 'string' || Array.isArray(value)), {
      ds: (postfix, path, state) => {
        // TODO (fix): Validate arguments...
        if (!ds) {
          throw new Error('invalid argument')
        }

        if (typeof state === 'string') {
          state = ds.record.STATE[state.toUpperCase()]
        }

        function observe(id, options) {
          if (id == null) {
            return rxjs.of(path ? undefined : {})
          }

          const name = (id || '') + (postfix || '')
          if (options?.observe) {
            return options.observe(name, path, state)
          } else {
            state ??=
              name.startsWith('{') || name.endsWith('?') ? ds.record.PROVIDER : ds.record.SERVER

            return ds.record.observe(name, path, state)
          }
        }

        return (value, options) => {
          if (value && fp.isString(value)) {
            return observe(value, options)
          }

          if (Array.isArray(value)) {
            value = value.filter((x) => x && fp.isString(x))
            return value.length
              ? rxjs.combineLatest(value.map((id) => observe(id, options)))
              : rxjs.of([])
          }

          return null
        }
      },
    }),
    // string
    ...asFilter(
      (value) =>
        value == null || fp.isPlainObject(value) || Array.isArray(value) ? '' : String(value),
      (value) => typeof value === 'string',
      {
        fromJSON: () => (value) => (value ? JSON.parse(value) : null),
        fromJSON5: () => (value) => (value ? JSON5.parse(value) : null),
        toSlate: () => (value) => ({
          object: 'value',
          document: {
            object: 'document',
            data: {},
            nodes: value.split('\n').map((line) => ({
              object: 'block',
              type: 'paragraph',
              data: {},
              nodes: [
                {
                  object: 'text',
                  leaves: [
                    {
                      object: 'leaf',
                      text: line,
                      marks: [],
                    },
                  ],
                },
              ],
            })),
          },
        }),
        append: (post) => (value) => value + post,
        prepend: (pre) => (value) => pre + value,
        asset: (type, _return = true) => {
          // TODO (fix): Validate arguments...
          if (!ds) {
            throw new Error('invalid argument')
          }

          return (value) =>
            value
              ? ds.record.observe2(`${value}:asset.rawTypes?`).pipe(
                  rxjs.map(({ state, data }) => ({
                    state,
                    data: fp.includes(type, data.value),
                  })),
                  rxjs.filter(({ state, data }) => data || state >= ds.record.PROVIDER),
                  rxjs.pluck('data'),
                  rxjs.distinctUntilChanged(),
                  rxjs.map((isType) => (isType ? value : _return ? RETURN : null)),
                )
              : null
        },
        lower: () => (value) => value.toLowerCase(),
        upper: () => (value) => value.toUpperCase(),
        match: (...args) => {
          // TODO (fix): Validate argument count...

          if (args.some((val) => typeof val !== 'string')) {
            throw new Error('invalid argument')
          }

          return (value) => value.match(new RegExp(...args))
        },
        capitalize: () => (value) => fp.capitalize(value),
        split: (delimiter) => (value) => value.split(delimiter),
        title: () => (value) => fp.startCase(value),
        replace: (...args) => {
          // TODO (fix): Validate argument count...

          if (args.some((val) => typeof val !== 'string')) {
            throw new Error('invalid argument')
          }

          if (args.length === 3) {
            const [pattern, flags, str] = args
            const expr = new RegExp(pattern, flags)
            return (value) => value.replace(expr, str)
          } else if (args.length === 2) {
            const [a, b] = args
            return (value) => value.replace(a, b)
          } else {
            throw new Error('invalid argument')
          }
        },
        padStart:
          (...args) =>
          (value) =>
            value.padStart(...args),
        padEnd:
          (...args) =>
          (value) =>
            value.padEnd(...args),
        charAt:
          (...args) =>
          (value) =>
            value.charAt(...args),
        startsWith:
          (...args) =>
          (value) =>
            value.startsWith(...args),
        endsWith:
          (...args) =>
          (value) =>
            value.endsWith(...args),
        substring:
          (...args) =>
          (value) =>
            value.substring(...args),
        slice:
          (...args) =>
          (value) =>
            value.slice(...args),
        trim: () => (value) => value.trim(),
        trimStart: () => (value) => value.trimStart(),
        trimEnd: () => (value) => value.trimEnd(),
        trimLeft: () => (value) => value.trimLeft(),
        trimRight: () => (value) => value.trimRight(),
        truncate:
          (length = 255, killwords = false, end = '...', leeway = 0) =>
          (value) => {
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

            return (
              s
                .slice(0, length - end.length)
                .trimRight()
                .split(' ')
                .slice(0, -1)
                .join(' ') + end
            )
          },
        wordcount: () => (value) => fp.words(value).length,
        words: () => (value) => fp.words(value),
      },
    ),
    ...asFilter(
      (value) => (Array.isArray(value) || typeof value === 'string' ? value : []),
      (value) => value.includes,
      {
        includes:
          (...args) =>
          (value) =>
            value.includes(...args),
      },
    ),
    // array
    ...asFilter(
      (value) => (Array.isArray(value) ? value : []),
      (value) => Array.isArray(value),
      {
        fromEntries: () => fp.fromPairs,
        fromPairs: () => fp.fromPairs,
        mergeAll: () => fp.mergeAll,
        map: (path) => (value) =>
          fp.isArray(path) ? fp.map(fp.pick(path), value) : fp.map(fp.get(path), value),
        every: (predicate) => (value) => fp.every(predicate, value),
        some: (predicate) => (value) => fp.some(predicate, value),
        filter: (predicate) => (value) => fp.filter(predicate, value),
        reject: (predicate) => (value) => fp.reject(predicate, value),
        findIndex: (predicate) => (value) => fp.findIndex(predicate, value),
        findLastIndex: (predicate) => (value) => fp.findLastIndex(predicate, value),
        find: (predicate) => (value) => fp.find(predicate, value),
        findLast: (predicate) => (value) => fp.findLast(predicate, value),
        slice: (start, end) => (value) => value.slice(start, end),
        reverse: () => (value) => fp.reverse(value),
        join: (delimiter) => (value) => fp.join(delimiter, value),
        at: (index) => (value) => value[index],
        first: () => (value) => fp.head(value),
        head: () => (value) => fp.head(value),
        last: () => (value) => fp.last(value),
        tail: () => (value) => fp.last(value),
        length: () => (value) => fp.size(value),
        size: () => (value) => fp.size(value),
        sort: () => (value) => [...value].sort(),
        sortBy: (iteratees) => (value) => fp.sortBy(iteratees, value),
        sum: () => (value) => fp.sum(value),
        unique: () => (value) => fp.uniq(value),
        uniq: () => (value) => fp.uniq(value),
        flatten:
          (depth = 1) =>
          (value) =>
            fp.flattenDepth(depth, value),
        flattenDeep: () => (value) => fp.flattenDeep(value),
        union:
          (...args) =>
          (value) =>
            fp.union(args[0], value),
        intersection:
          (...args) =>
          (value) =>
            fp.intersection(args[0], value),
        concat:
          (...args) =>
          (value) =>
            fp.concat(value, args[0]),
        difference:
          (...args) =>
          (value) =>
            fp.difference(value, args[0]),
        initial: () => (value) => fp.initial(value),
        compact: () => (value) => fp.compact(value),
        pull:
          (...args) =>
          (value) =>
            fp.pull(args[0], value),
      },
    ),
    // object
    ...asFilter(
      (value) => (fp.isPlainObject(value) ? value : {}),
      (value) => fp.isPlainObject(value),
      {
        merge: (value) => fp.merge(value),
        set: (path, value) => fp.set(path, value),
      },
    ),
    // collection
    ...asFilter(
      (value) => (Array.isArray(value) || fp.isPlainObject(value) ? value : []),
      (value) => Array.isArray(value) || fp.isPlainObject(value),
      {
        pluck: (path) => (value) => fp.get(path, value),
        pick: (paths) => (value) => fp.pick(paths, value),
        omit: (paths) => (value) => fp.omit(paths, value),
        get: (path) => (value) => fp.get(path, value),
        values: () => (value) => fp.values(value),
        keys: () => (value) => fp.keys(value),
        size: () => (value) => fp.size(value),
        entries: () => (value) => fp.entries(value),
      },
    ),
    // misc
    ...asFilter(null, null, {
      timer: (period) => (dueTime) => {
        if (moment.isMoment(dueTime)) {
          if (!dueTime.isValid()) {
            return null
          }
          dueTime = dueTime.toDate()
        } else if (dueTime instanceof Date) {
          if (isNaN(dueTime)) {
            return null
          }
        } else if (!Number.isFinite(dueTime)) {
          return null
        }

        if (period !== '' && period != null && !Number.isFinite(period)) {
          return null
        }

        return rxjs.timer(dueTime, period).pipe(
          rxjs.map(() => moment()),
          rxjs.startWith(null),
        )
      },
    }),
  }

  const getFilter = makeWeakCache((filterStr) => {
    const [, filterName, argsStr] =
      filterStr
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .match(/([^(]+)\((.*)\)/) || []

    const tokens = split(argsStr, {
      separator: ',',
      brackets: true,
      quotes: ['"'],
    })

    const args = tokens.map((x) => {
      try {
        x = x.trim()
        if (x === 'undefined' || x === '') {
          return undefined
        }
        if (x === 'null') {
          return null
        }
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
  })

  const getValue = (value, [path, ...rest]) => {
    if (!path || !value || typeof value !== 'object') {
      return rxjs.isObservable(value) ? value : rxjs.of(value)
    } else {
      return rxjs.isObservable(value)
        ? value.pipe(
            rxjs.switchMap((value) => getValue(value[path], rest)),
            rxjs.distinctUntilChanged(),
          )
        : getValue(value[path], rest)
    }
  }

  const reduceValue = (value, index, filters, options) => {
    if (value === RETURN) {
      return rxjs.of(null)
    }

    while (index < filters.length) {
      value = filters[index++](value, options)

      if (value === RETURN) {
        return rxjs.of(null)
      }

      if (rxjs.isObservable(value)) {
        return value.pipe(
          rxjs.switchMap((value) => reduceValue(value, index, filters, options)),
          rxjs.distinctUntilChanged(),
          // TODO (fix): better error handling...
          rxjs.catchError(() => rxjs.of(null)),
        )
      }
    }

    return rxjs.of(value)
  }

  return makeWeakCache((expression) => {
    try {
      const [basePathStr, ...tokens] = split(expression, {
        separator: '|',
        quotes: ['"'],
      }).map((str) => str.trim())

      const filters = tokens.map(getFilter)
      const basePath = fp.toPath(basePathStr)

      return (context, options) =>
        getValue(context, basePath).pipe(
          rxjs.switchMap((value) => reduceValue(value, 0, filters, options)),
          rxjs.distinctUntilChanged(),
          rxjs.catchError((err) => {
            options?.logger?.error(
              { err, expression: { expression, context: JSON.stringify(context) } },
              'expression failed',
            )
            return rxjs.of(null)
          }),
        )
    } catch (err) {
      throw new NestedError(`failed to parse expression ${expression}`, err)
    }
  })
}
