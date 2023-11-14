import qs from 'qs'
import cached from './util/cached.js'
import undici from 'undici'
import stream from 'node:stream'
import split2 from 'split2'
import { defaultDelay as delay } from './http.js'

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

export function makeDeepstream(ds) {
  const nxt = {
    ds,
    record: {
      provide: (...args) => provide(ds, ...args),
      observe: (...args) => observe(ds, ...args),
      observe2: (...args) => observe2(ds, ...args),
      set: (...args) => ds.record.set(...args),
      get: (...args) => get(ds, ...args),
      update: (...args) => ds.record.update(...args),
      changes: (...args) => changes(ds, ...args),
    },
  }
  ds.nxt = nxt
  return nxt
}

async function* changes(
  ds,
  {
    origin,
    since = 'now',
    live = true,
    batched = false,
    includeDocs = false,
    highWaterMark = 256 * 1024,
    heartbeat = 60e3,
    signal,
    retry,
  },
) {
  const url = new URL('/_record/changes', origin)

  url.searchParams.set('since', since || '0')
  url.searchParams.set('live', String(live))
  url.searchParams.set('include_docs', String(includeDocs))

  let ac

  const abort = () => {
    ac?.abort(signal.reason)
  }

  signal?.addEventListener('abort', abort)

  try {
    for (let retryCount = 0; true; retryCount++) {
      ac = new AbortController()
      try {
        // TODO (fix): Use nxt-undici
        const res = await undici.request(url, {
          idempotent: false,
          blocking: true,
          method: 'GET',
          signal: ac.signal,
          throwOnError: true,
          highWaterMark,
          bodyTimeout: 2 * heartbeat,
        })

        const src = stream.pipeline(res.body, split2(), () => {})

        let error
        let ended = false
        let resume = () => {}

        src
          .on('error', (err) => {
            error = err
            resume()
          })
          .on('readable', () => {
            resume()
          })
          .on('end', () => {
            ended = true
            resume()
          })

        const batch = batched ? [] : null
        while (true) {
          const line = src.read()

          if (line === '') {
            continue
          } else if (line !== null) {
            const change = JSON.parse(line)

            retryCount = 0

            if (change.seq) {
              since = change.seq
            }
            if (batch) {
              batch.push(change)
            } else {
              yield change
            }
          } else if (batch?.length) {
            yield batch.splice(0)
          } else if (error) {
            throw error
          } else if (ended) {
            return
          } else {
            await new Promise((resolve) => {
              resume = resolve
            })
          }
        }
      } catch (err) {
        if (typeof retry === 'function') {
          const retryState = { since }
          await retry(err, retryCount, retryState, { signal: ac.signal })
          url.searchParams.set('since', since || '0')
        } else {
          await delay(err, retryCount, { signal: ac.signal })
        }
      } finally {
        ac.abort()
        ac = null
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

Object.assign(makeDeepstream, {
  changes,
  provide,
  observe,
  observe2,
  get,
  record: {
    changes,
    provide,
    observe,
    observe2,
    get,
  },
})
