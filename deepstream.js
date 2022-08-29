const qs = require('qs')
const cached = require('./util/cached')

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
      cachedOptions.keySelector ? cachedOptions.keySelector : (id, options, key) => key
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
    `^${idExpr}(${domain})(?:\\?.*)?$`,
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
      ...(query ? qs.parse(query) : null),
      ...(json ? JSON.parse(json) : null),
    },
  ]
}

function observe(ds, name, ...args) {
  let query = null

  if (args[0] == null || typeof args[0] === 'object') {
    query = args.shift()
    query = query ? JSON.parse(JSON.stringify(query)) : null
  }

  return ds.record.observe(
    `${name}${query && Object.keys(query).length > 0 ? `?${qs.stringify(query)}` : ''}`,
    ...args
  )
}

function observe2(ds, name, ...args) {
  let query = null

  if (args[0] == null || typeof args[0] === 'object') {
    query = args.shift()
    query = query ? JSON.parse(JSON.stringify(query)) : null
  }

  return ds.record.observe2(
    `${name}${query && Object.keys(query).length > 0 ? `?${qs.stringify(query)}` : ''}`,
    ...args
  )
}

function get(ds, name, ...args) {
  let options = null

  if (args[0] && typeof args[0] === 'object') {
    options = JSON.parse(JSON.stringify(args.shift()))
  }

  return ds.record.get(
    `${name}${options && Object.keys(options).length > 0 ? `?${qs.stringify(options)}` : ''}`,
    ...args
  )
}

function init(ds) {
  const nxt = {
    ds,
    record: {
      provide: (...args) => provide(ds, ...args),
      observe: (...args) => observe(ds, ...args),
      observe2: (...args) => observe2(ds, ...args),
      set: (...args) => ds.record.set(...args),
      get: (...args) => get(ds, ...args),
      update: (...args) => ds.record.update(...args),
    },
  }
  ds.nxt = nxt
  return nxt
}

module.exports = Object.assign(init, {
  provide,
  observe,
  observe2,
  get,
  record: {
    provide,
    observe,
    observe2,
    get,
  },
})
