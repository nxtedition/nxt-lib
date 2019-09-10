const querystring = require('querystring')
const objectHash = require('object-hash')
const cached = require('./util/cached')

function provide (ds, domain, callback, options) {
  if (!options || typeof options !== 'object') {
    options = {
      recursive: options === true
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
    callback = cached(
      callback,
      options,
      (id, options, key) => key
    )
  }

  let idExpr = '(.*:)?'
  if (options.id === true) {
    idExpr = '([^{}]+:)'
  } else if (options.id === false) {
    idExpr = '({.*}:|)?'
  }

  return ds.record.provide(`^${idExpr}${domain.replace('.', '\\.')}(\\?.*)?$`, key => {
    const [id, options] = parseKey(key)
    return callback(id, options, key)
  }, options.recursive)
}

function parseKey (key) {
  const { json, id, query } = key.match(/^(?:(?<json>\{.*\}):|(?<id>.*):)?[^?]*(?:\?(?<query>.*))?$/).groups
  if (query) {
    return [id || '', querystring.parse(query)]
  } else if (json) {
    return ['', JSON.parse(json)]
  } else {
    return [id || '', {}]
  }
}

function query (ds, { view, filter, state = ds.record.PROVIDER, ...options }) {
  let x$
  if (view || filter) {
    view = stringifyFn(view)
    filter = stringifyFn(filter)

    const id = objectHash({ view, filter })
    ds.record.set(`${id}:_query`, { view, filter })
    x$ = ds.record.observe2(`${id}:query?${querystring.stringify(options)}`)
  } else {
    x$ = ds.record.observe2(`query?${querystring.stringify(options)}`)
  }
  return x$
    .filter(x => !state || x.state >= state)
    .map(({ data, ...x }) => ({
      ...x,
      rows: Array.isArray(data && data.rows) ? data.rows : []
    }))
}

function stringifyFn (fn) {
  return typeof fn === 'function' ? fn.toString().match(/\{([\s\S]+)\}/m)[1] : fn
}

function observe (ds, domain, optionsOrState, state) {
  let options = optionsOrState

  if (optionsOrState != null && typeof optionsOrState !== 'object') {
    state = optionsOrState
    options = null
  }

  return ds.record.observe(`${domain}${options && Object.keys(options).length > 0 ? `?${querystring.stringify(options)}` : ''}`, state)
}

module.exports = { provide, query, observe }
