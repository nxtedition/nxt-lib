const querystring = require('querystring')
const objectHash = require('object-hash')
const cached = require('./util/cached')
const rx = require('rxjs/operators')

function provide(ds, domain, callback, options) {
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
      cachedOptions.keySelector ? cachedOptions.keySelector : (id, options, key) => key
    )
  } else if (options.minAge) {
    // Backwards compat
    callback = cached(callback, options, (id, options, key) => key)
  }

  let idExpr = '(?:([^{}])+:|{.*}:)?'
  if (options.id === true) {
    idExpr = '([^{}]+:)'
  } else if (options.id === false) {
    idExpr = '(?:{.*}:)?'
  }

  return ds.record.provide(
    `^${idExpr}${domain.replace('.', '\\.')}(?:\\?.*)?$`,
    (key) => {
      const [id, options] = parseKey(key)
      return callback(id, options, key)
    },
    options.recursive,
    options.schema
  )
}

function parseKey(key) {
  const { json, id, query } = key.match(
    /^(?:(?<json>\{.*\}):|(?<id>.*):)?[^?]*(?:\?(?<query>.*))?$/
  ).groups
  return [
    id || '',
    {
      ...(query ? querystring.parse(query) : null),
      ...(json ? JSON.parse(json) : null),
    },
  ]
}

function query(ds, { view, filter, state = ds.record.PROVIDER, ...options }, state2) {
  let x$
  if (!state && state2) {
    state = state2
  }
  if (view || filter) {
    view = stringifyFn(view)
    filter = stringifyFn(filter)

    const id = objectHash({ view, filter })
    ds.record.set(`${id}:_query`, { view, filter })
    x$ = ds.record.observe2(`${id}:query?${querystring.stringify(options)}`)
  } else {
    x$ = ds.record.observe2(`query?${querystring.stringify(options)}`)
  }
  return x$.pipe(
    rx.filter((x) => !state || x.state >= state),
    rx.map(({ data, state }) => ({
      ...data,
      state,
      rows: Array.isArray(data && data.rows) ? data.rows : [],
    }))
  )
}

function stringifyFn(fn) {
  return typeof fn === 'function' ? fn.toString().match(/\{([\s\S]+)\}/m)[1] : fn
}

function observe(ds, name, ...args) {
  let options = null

  if (args[0] && typeof args[0] === 'object') {
    options = JSON.parse(JSON.stringify(args.shift()))
  }

  return ds.record.observe(
    `${name}${
      options && Object.keys(options).length > 0 ? `?${querystring.stringify(options)}` : ''
    }`,
    ...args
  )
}

function observe2(ds, name, ...args) {
  let options = null

  if (args[0] && typeof args[0] === 'object') {
    options = JSON.parse(JSON.stringify(args.shift()))
  }

  return ds.record.observe2(
    `${name}${
      options && Object.keys(options).length > 0 ? `?${querystring.stringify(options)}` : ''
    }`,
    ...args
  )
}

function init(ds) {
  const nxt = {
    ds,
    record: {
      query: (...args) => query(ds, ...args),
      provide: (...args) => provide(ds, ...args),
      observe: (...args) => observe(ds, ...args),
      observe2: (...args) => observe2(ds, ...args),
      set: (...args) => ds.set(...args),
      get: (...args) => ds.get(...args),
      update: (...args) => ds.update(...args),
    },
  }
  ds.nxt = nxt
  return nxt
}

module.exports = Object.assign(init, {
  provide,
  query,
  observe,
  observe2,
  record: {
    query,
    provide,
    observe,
    observe2,
  },
})
