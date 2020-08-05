const querystring = require('querystring')
const objectHash = require('object-hash')
const cached = require('./util/cached')
const xuid = require('xuid')
const { Observable, ReplaySubject } = require('rxjs')
const rx = require('rxjs/operators')

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
  return [
    id || '',
    {
      ...(query ? querystring.parse(query) : null),
      ...(json ? JSON.parse(json) : null)
    }
  ]
}

function query (ds, { view, filter, state = ds.record.PROVIDER, ...options }, state2) {
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
  return x$
    .map(({ data, state }) => ({
      state: Math.min(data.state || 0, state),
      rows: Array.isArray(data && data.rows) ? data.rows : []
    }))
    .filter(x => !state || x.state >= state)
}

function stringifyFn (fn) {
  return typeof fn === 'function' ? fn.toString().match(/\{([\s\S]+)\}/m)[1] : fn
}

function observe (ds, name, ...args) {
  let options = null

  if (args[0] && typeof args[0] === 'object') {
    options = JSON.parse(JSON.stringify(args.shift()))
  }

  return ds.record.observe(`${name}${options && Object.keys(options).length > 0 ? `?${querystring.stringify(options)}` : ''}`, ...args)
}

function rpcProvide (ds, rpcName, callback, options) {
  return provide(ds, rpcName, (id, options) => {
    try {
      let ret$ = callback(options, id)

      if (!options || !options.recursive) {
        ret$ = Observable.of(ret$)
      }

      return ret$
        .map(ret => !ret ? null : ret
          .map(data => ({ data }))
          .concat(Observable.of({ error: null }))
          .catch(err => Observable.of({ error: err.message }))
          .scan((xs, x) => ({ ...xs, ...x }))
        )
    } catch (err) {
      return Observable.of({ error: err.message })
    }
  }, { id: true, recursive: true })
}

function rpcObserve (ds, rpcName, data) {
  return Observable.defer(() => {
    const rpcId = xuid()
    return observe(ds, `${rpcId}:${rpcName}`, data, ds.record.PROVIDER)
      .pipe(rx.takeWhile(({ error }) => error === undefined, true))
      .map(({ data, error }) => {
        if (error) {
          throw error
        }
        return data
      })
      .filter(Boolean)
  })
}

function rpcMake (ds, rpcName, data, options) {
  const subject = new ReplaySubject(1)
  rpcObserve(ds, rpcName, data)
    .timeout(Number.isFinite(options)
      ? options
      : Number.isFinite(options && options.timeout)
        ? options.timeout
        : 10e3
    )
    .subscribe(subject)
  return subject
}

function init (ds) {
  const nxt = {
    ds,
    query: (...args) => query(ds, ...args),
    record: {
      query: (...args) => query(ds, ...args),
      provide: (...args) => provide(ds, ...args),
      observe: (...args) => observe(ds, ...args),
      set: (...args) => ds.set(...args),
      get: (...args) => ds.get(...args),
      update: (...args) => ds.update(...args)
    },
    rpc: {
      provide: (...args) => rpcProvide(ds, ...args),
      observe: (...args) => rpcObserve(ds, ...args),
      make: (...args) => rpcMake(ds, ...args)
    }
  }
  ds.nxt = nxt
  return nxt
}

module.exports = Object.assign(init, {
  provide,
  query,
  observe,
  record: {
    query,
    provide,
    observe
  },
  rpc: {
    provide: rpcProvide,
    observe: rpcObserve,
    make: rpcMake
  }
})
