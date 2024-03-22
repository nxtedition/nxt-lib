import assert from 'node:assert'
import qs from 'qs'
import cached from './util/cached.js'
import * as rxjs from 'rxjs'

function provide(ds, domain, callback, options) {
  if (domain instanceof RegExp) {
    domain = domain.source
  } else {
    domain = domain.replace('.', '\\.')
  }

  if (!options || typeof options !== 'object') {
    options = {
      recursive: options === true,
    }
  }

  if (options.cached) {
    let cachedOptions = options.cached
    if (typeof cachedOptions === 'number') {
      cachedOptions = { maxAge: cachedOptions }
    }

    callback = cached(
      callback,
      cachedOptions,
      cachedOptions.keySelector ? cachedOptions.keySelector : (id, options, key) => key,
    )
  } else if (options.minAge) {
    // Backwards compat
    callback = cached(callback, options, (id, options, key) => key)
  }

  let idExpr = '(?:([^{}]+|{.*}):)?'
  if (options.id === true) {
    idExpr = '([^{}]+):'
  } else if (options.id === false) {
    idExpr = '(?:({.*}):)?'
  }

  return ds.record.provide(
    `^${idExpr}(${domain})(?:[?].*)${options.strict ? '' : '?'}$`,
    (key) => {
      const [id, options] = parseKey(key)
      return callback(id, options, key)
    },
    { recursive: options.recursive, mode: options.mode, stringify: options.stringify },
  )
}

function parseKey(key) {
  const { json, id, query } = key.match(
    /^(?:(?<json>\{.*\}):|(?<id>.*):)?[^?]*(?:\?(?<query>.*))?$/,
  ).groups
  return [
    id || '',
    {
      ...(query ? qs.parse(query) : null),
      ...(json ? JSON.parse(json) : null),
    },
  ]
}

function observe(ds, name, ...args) {
  let query = null

  if (args.length > 0 && (args[0] == null || typeof args[0] === 'object')) {
    query = args.shift()
  }

  name = `${name}`

  return ds.record.observe(
    `${name}${
      query && Object.keys(query).length > 0
        ? `${name.endsWith('?') ? '' : '?'}${qs.stringify(query, { skipNulls: true })}`
        : ''
    }`,
    ...args,
  )
}

function observe2(ds, name, ...args) {
  let query = null

  if (args.length > 0 && (args[0] == null || typeof args[0] === 'object')) {
    query = args.shift()
  }

  name = `${name}`

  return ds.record.observe2(
    `${name}${
      query && Object.keys(query).length > 0
        ? `${name.endsWith('?') ? '' : '?'}${qs.stringify(query, { skipNulls: true })}`
        : ''
    }`,
    ...args,
  )
}

function get(ds, name, ...args) {
  let query = null

  if (args.length > 0 && (args[0] == null || typeof args[0] === 'object')) {
    query = args.shift()
  }

  name = `${name}`

  return ds.record.get(
    `${name}${
      query && Object.keys(query).length > 0
        ? `${name.endsWith('?') ? '' : '?'}${qs.stringify(query, { skipNulls: true })}`
        : ''
    }`,
    ...args,
  )
}

function query(ds, designId, options) {
  const next = (startkey, prevRows, limit) =>
    !limit
      ? rxjs.of({ rows: prevRows })
      : ds.nxt.record
          .observe(
            `${designId}:design?${qs.stringify(
              {
                ...options,
                startkey,
                limit: Number.isFinite(limit) ? limit : null,
              },
              { skipNulls: true },
            )}`,
            ds.record.PROVIDER,
          )
          .pipe(
            rxjs.switchMap(({ rows, finished }) => {
              assert(Array.isArray(rows))
              assert(typeof finished === 'boolean')

              const nextRows = prevRows.length ? [...prevRows, ...rows] : rows
              if (finished) {
                return rxjs.of({ rows: nextRows })
              } else {
                const last = rows.pop()
                assert(last.key)
                assert(rows.length > 0)
                return next(last.key, nextRows, limit - rows.length)
              }
            }),
          )
  return next(options.startkey, [], options.limit ?? Infinity)
}

export function makeDeepstream(ds) {
  const nxt = {
    ds,
    record: {
      provide: (...args) => provide(ds, ...args),
      observe: (...args) => observe(ds, ...args),
      observe2: (...args) => observe2(ds, ...args),
      query: (...args) => query(ds, ...args),
      set: (...args) => ds.record.set(...args),
      get: (...args) => get(ds, ...args),
      update: (...args) => ds.record.update(...args),
    },
  }
  ds.nxt = nxt
  return nxt
}

Object.assign(makeDeepstream, {
  provide,
  observe,
  observe2,
  query,
  get,
  record: {
    provide,
    observe,
    observe2,
    query,
    get,
  },
})
