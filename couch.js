import assert from 'node:assert'
import createError from 'http-errors'
import { makeWeakCache } from './weakCache.js'
import tp from 'timers/promises'
import { defaultDelay as delay } from './http.js'
import querystring from 'querystring'
import urljoin from 'url-join'
import undici from 'undici'
import { AbortError } from './errors.js'
import split2 from 'split2'
import stream from 'node:stream'

// https://github.com/fastify/fastify/blob/main/lib/reqIdGenFactory.js
// 2,147,483,647 (2^31 − 1) stands for max SMI value (an internal optimization of V8).
// With this upper bound, if you'll be generating 1k ids/sec, you're going to hit it in ~25 days.
// This is very likely to happen in real-world applications, hence the limit is enforced.
// Growing beyond this value will make the id generation slower and cause a deopt.
// In the worst cases, it will become a float, losing accuracy.
const maxInt = 2147483647
let nextReqId = Math.floor(Math.random() * maxInt)
function genReqId() {
  nextReqId = (nextReqId + 1) & maxInt
  return `req-${nextReqId.toString(36)}`
}

function parseHeaders(headers, obj = {}) {
  for (let i = 0; i < headers.length; i += 2) {
    const key = headers[i].toString().toLowerCase()
    let val = obj[key]
    if (!val) {
      obj[key] = headers[i + 1].toString()
    } else {
      if (!Array.isArray(val)) {
        val = [val]
        obj[key] = val
      }
      val.push(headers[i + 1].toString())
    }
  }
  return obj
}

export function makeCouch(opts) {
  let config
  if (typeof opts === 'string') {
    config = opts
  } else if (Array.isArray(opts)) {
    config = opts
  } else if (opts?.url) {
    config = opts
  } else if (opts?.couchdb || opts?.couch) {
    config = opts.couchdb || opts.couch
  } else if (opts?.config) {
    config = opts.config.couchdb || opts.config.couch || opts.config
  } else {
    throw new Error('invalid options')
  }

  if (typeof config === 'string') {
    config = { url: config }
  }

  if (!config.url && config.name) {
    config = { ...config, url: config.name }
  }

  const { origin: dbOrigin, pathname: dbPathname } = new URL(
    Array.isArray(config.url) ? config.url[0] : config.url,
  )

  const defaultClientOpts = {
    keepAliveTimeout: 2 * 60e3,
    headersTimeout: 10 * 60e3,
    bodyTimeout: 2 * 60e3,
    connections: 256,
  }

  const userAgent = config.userAgent
  const defaultClient = new undici.Pool(dbOrigin, defaultClientOpts)

  const getClient =
    config.getClient ??
    makeWeakCache(
      () =>
        new undici.Pool(dbOrigin, {
          ...defaultClientOpts,
          connections: 4, // TODO (fix): Global limit?
          pipelining: 2,
        }),
    )

  function makeError(req, res) {
    let path

    if (req.path) {
      path = req.path
    } else {
      path = dbPathname
      if (req.pathname) {
        path = urljoin(path, req.pathname)
      }
      if (req.params) {
        path += `?${querystring.stringify(req.params)}`
      }
    }

    let reason
    let error
    try {
      const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
      reason = json.reason
      error = json.error
    } catch {
      // Do nothing...
    }

    return createError(res.status, {
      reason,
      error,
      data: {
        req: {
          origin: dbOrigin,
          path,
          method: req.method,
          headers: req.headers,
          body: req.body ? JSON.stringify(req.body).slice(0, 4096) : null,
        },
        res: {
          status: res.status,
          headers: res.headers,
          body: res.data,
        },
      },
    })
  }

  async function* changes({ client = defaultClient, signal, highWaterMark, ...options } = {}) {
    const params = {}

    let body
    let method = 'GET'

    if (options.conflicts) {
      params.conflicts = true
    }

    if (options.descending) {
      params.descending = true
    }

    if (options.include_docs) {
      params.include_docs = true
    }

    if (options.seq_interval != null) {
      params.seq_interval = options.seq_interval
    }

    if (options.since != null) {
      params.since = options.since
    }

    if (options.until != null) {
      params.until = options.until
    }

    if (options.style != null) {
      params.style = options.style
    }

    if (options.view != null) {
      params.view = options.view
    }

    if (options.filter != null) {
      params.filter = options.filter
    }

    if (options.heartbeat != null) {
      params.heartbeat = options.heartbeat
    } else {
      params.heartbeat = 10e3
    }

    if (options.timeout != null) {
      params.timeout = options.timeout
    }

    if (options.limit != null) {
      params.limit = options.limit
    }

    if (options.doc_ids != null) {
      method = 'POST'
      body = { ...body, doc_ids: options.doc_ids }
    }

    if (options.selector != null) {
      method = 'POST'
      body = { ...body, selector: options.selector }
      params.filter = '_selector'
    }

    if (dbPathname === '/') {
      throw new Error('invalid pathname')
    }

    const batched = options.batched || false
    const live = options.live == null || !!options.live
    const retry = options.retry

    let retryCount = 0

    const ac = new AbortController()
    const onAbort = () => {
      ac.abort()
    }

    if (signal) {
      if (signal.aborted) {
        throw signal.reason ?? new AbortError()
      }

      if (signal.on) {
        signal.on('abort', onAbort)
      } else if (signal.addEventListener) {
        signal.addEventListener('abort', onAbort)
      }
    }

    async function parse(live, params) {
      const req = {
        path: `${dbPathname}/_changes?${new URLSearchParams(params)}`,
        idempotent: false,
        blocking: true,
        method,
        body: JSON.stringify(body),
        signal: ac.signal,
        headers: {
          'user-agent': userAgent,
          'request-id': genReqId(),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        highWaterMark: 256 * 1024, // TODO (fix): Needs support in undici...
        bodyTimeout: 2 * (params.heartbeat || 60e3),
      }

      const res = await client.request(req)

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw makeError(req, {
          status: res.statusCode,
          headers: res.headers,
          data: await res.body.text(),
        })
      }

      return stream.pipeline(
        res.body,
        split2('\n', { writableHighWaterMark: highWaterMark ?? 128 * 1024 }),
        () => {},
      )
    }

    let remaining = Number(options.limit) || Infinity
    try {
      while (true) {
        try {
          const params2 = {
            ...params,
            ...options.query,
            feed: live ? 'continuous' : 'normal',
          }

          if (Number.isFinite(remaining)) {
            params.limit = remaining
          }

          const src = await parse(live, params2)
          const changes = []

          let resume = null
          let error = null
          let ended = false
          let state = 0

          src
            .on('readable', () => {
              if (resume) {
                resume()
                resume = null
              }
            })
            .on('error', (err) => {
              error = err

              if (resume) {
                resume()
                resume = null
              }
            })
            .on('end', () => {
              ended = true
            })

          while (true) {
            const line = src.read()
            if (line) {
              if (live) {
                const data = JSON.parse(line)
                if (data.last_seq) {
                  params.since = data.last_seq
                } else {
                  params.since = data.seq || params.since
                  this.push(data)
                }
              } else {
                // NOTE: This makes some assumptions about the format of the JSON.
                if (state === 0) {
                  if (line.endsWith('[')) {
                    state = 1
                  } else {
                    assert(false, 'invalid head: ' + line)
                  }
                } else if (state === 1) {
                  if (line.startsWith(']')) {
                    state = 2
                  } else {
                    const idx = line.lastIndexOf('}') + 1
                    assert(idx > 0, 'invalid row: ' + line)
                    const change = JSON.parse(line.slice(0, idx))
                    params.since = change.seq || params.since
                    changes.push(change)
                  }
                } else if (state === 2) {
                  state = 3
                  params.since = JSON.parse('{' + line).last_seq
                  assert(params.since, 'invalid trailer: ' + line)
                }
              }
            } else if (changes.length) {
              remaining -= changes.length
              assert(remaining >= 0, 'invalid remaining: ' + remaining)

              if (batched) {
                yield changes.splice(0)
              } else {
                yield* changes.splice(0)
              }
            } else if (error) {
              throw error
            } else if (!ended) {
              await new Promise((resolve) => {
                resume = resolve
              })
            } else {
              return
            }
          }
        } catch (err) {
          if (err.name === 'AbortError') {
            throw err
          } else if (typeof retry === 'function') {
            const retryState = { since: params.since }
            Object.assign(
              retryState,
              await retry(err, retryCount++, retryState, { signal }, () =>
                delay(err, retryCount, { signal }),
              ),
            )
            params.since = retryState.since ?? 0
          } else {
            await delay(err, retryCount, { signal })
          }
        }
      }
    } finally {
      ac.abort()
      if (signal) {
        if (signal.off) {
          signal.off('abort', onAbort)
        } else if (signal.removeEventListener) {
          signal.removeEventListener('abort', onAbort)
        }
      }
    }
  }

  const ACCEPT_HEADERS = ['Accept', 'application/json']
  const ACCEPT_CONTENT_TYPE_HEADERS = [...ACCEPT_HEADERS, 'Content-Type', 'application/json']

  async function request(url, opts) {
    for (let n = 0; true; ++n) {
      try {
        return await _request(url, opts)
      } catch (err) {
        if (
          !opts.idempotent ||
          n >= 10 ||
          (err.code !== 'UND_ERR_SOCKET' &&
            err.code !== 'ECONNRESET' &&
            err.code !== 'ECONNREFUSED' &&
            err.code !== 'EHOSTUNREACH' &&
            err.message !== 'write EPIPE')
        ) {
          throw err
        }
        await tp.setTimeout(n * 1e3)
      }
    }
  }

  function _request(
    url,
    { params, client = defaultClient, idempotent, body, method, headers, signal },
  ) {
    if (Array.isArray(headers)) {
      // Do nothing...
    } else if (headers) {
      const entries = Object.entries(headers)
      headers = []
      for (const [key, val] of entries) {
        headers.push(key, val)
      }
    } else {
      headers = body ? ACCEPT_CONTENT_TYPE_HEADERS : ACCEPT_HEADERS
    }

    if (
      userAgent &&
      headers.some((element, index) => index % 2 === 0 && /user-agent/i.test(element))
    ) {
      headers.push('user-agent', userAgent)
    }

    let path = dbPathname

    if (url) {
      path = urljoin(
        path,
        url
          .split('/')
          .map((part) => encodeURIComponent(part))
          .join('/'),
      )
    }

    if (params) {
      path += `?${querystring.stringify(params)}`
    }

    const req = {
      path,
      origin: dbOrigin,
      idempotent,
      method,
      body: typeof body === 'object' && body ? JSON.stringify(body) : body,
      headers,
    }

    return new Promise((resolve, reject) =>
      client.dispatch(req, {
        resolve,
        reject,
        signal,
        status: null,
        headers: null,
        abort: null,
        data: '',
        onConnect(abort) {
          if (!this.signal) {
            return
          }

          if (this.signal.aborted) {
            abort()
            return
          }

          this.abort = abort
          if ('addEventListener' in this.signal) {
            this.signal.addEventListener('abort', abort)
          } else {
            this.signal.addListener('abort', abort)
          }
        },
        onHeaders(statusCode, headers) {
          this.status = statusCode
          this.headers = parseHeaders(headers)
        },
        onData(chunk) {
          this.data += chunk
        },
        onComplete() {
          if (this.signal) {
            if ('removeEventListener' in this.signal) {
              this.signal.removeEventListener('abort', this.abort)
            } else {
              this.signal.removeListener('abort', this.abort)
            }
          }

          let data = this.data
          if (this.headers['content-type']?.toLowerCase() === 'application/json') {
            data = JSON.parse(this.data)
          }

          if (this.status < 200 || this.status >= 300) {
            this.reject(
              makeError(req, {
                status: this.status,
                headers: this.headers,
                data: this.data,
              }),
            )
          } else {
            this.resolve({
              data,
              status: this.status,
              headers: this.headers,
            })
          }
        },
        onError(err) {
          if (this.signal) {
            if ('removeEventListener' in this.signal) {
              this.signal.removeEventListener('abort', this.abort)
            } else {
              this.signal.removeListener('abort', this.abort)
            }
          }

          this.reject(err)
        },
      }),
    )
  }

  async function bulkDocs(body, opts = {}) {
    const { client = getClient('_bulk_docs'), signal, idempotent = true } = opts
    const req = {
      pathname: '_bulk_docs',
      client,
      idempotent,
      body,
      method: 'POST',
      signal,
    }
    const res = await request(req.pathname, req)

    if (res.status !== 201) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function allDocs(pathname, opts = {}) {
    if (pathname && typeof pathname === 'object') {
      opts = pathname
      pathname = null
    }

    pathname = pathname || '_all_docs'

    const { client = getClient(pathname), signal, idempotent = true, ...options } = opts

    const params = {}
    const headers = ['Accept', 'application/json']

    let method = 'GET'
    let body

    if (options.conflicts) {
      params.conflicts = true
    }

    if (options.update_seq) {
      params.update_seq = true
    }

    if (options.descending) {
      params.descending = true
    }

    if (options.include_docs) {
      params.include_docs = true
    }

    if (options.include_docs) {
      params.include_docs = true
    }

    if (options.sorted) {
      params.sorted = true
    }

    if (options.key != null) {
      params.key = JSON.stringify(options.key)
    }

    if (options.start_key != null) {
      options.startkey = options.start_key
    }

    if (options.startkey != null) {
      params.startkey = JSON.stringify(options.startkey)
    }

    if (options.startkey_docid != null) {
      params.startkey_docid = JSON.stringify(options.startkey_docid)
    }

    if (options.end_key != null) {
      options.endkey = options.end_key
    }

    if (options.endkey != null) {
      params.endkey = JSON.stringify(options.endkey)
    }

    if (options.inclusive_end != null) {
      params.inclusive_end = !!options.inclusive_end
    }

    if (options.limit != null) {
      params.limit = options.limit
    }

    if (options.skip != null) {
      params.skip = options.skip
    }

    if (options.stale != null) {
      params.stale = options.stale
    }

    if (options.reduce != null) {
      params.reduce = options.reduce
    }

    if (options.group != null) {
      params.group = options.group
    }

    if (options.group_level != null) {
      params.group_level = options.group_level
    }

    if (options.keys != null) {
      method = 'POST'
      body = { keys: options.keys }
      headers.push('Content-Type', 'application/json')
    }

    const req = {
      pathname: pathname || '_all_docs',
      params,
      client,
      idempotent,
      body,
      method,
      headers,
      signal,
    }
    const res = await request(req.pathname, req)

    if (res.status !== 200) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function put(pathname, params, body, { client, signal, idempotent = true, headers } = {}) {
    const req = {
      pathname,
      params,
      client,
      idempotent,
      body,
      method: 'PUT',
      headers,
      signal,
    }
    const res = await request(req.pathname, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function post(pathname, params, body, opts = {}) {
    const { client, signal, idempotent = true, headers } = opts
    const req = {
      pathname,
      params,
      client,
      idempotent,
      body,
      method: 'POST',
      headers,
      signal,
    }
    const res = await request(req.pathname, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function get(
    pathname,
    params,
    body,
    { client = getClient('_all_docs'), signal, idempotent = true, headers } = {},
  ) {
    const req = {
      pathname,
      params,
      client,
      idempotent,
      body,
      method: 'GET',
      headers,
      signal,
    }
    const res = await request(req.pathname, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function _delete(
    pathname,
    params,
    body,
    { client, signal, idempotent = true, headers } = {},
  ) {
    const req = {
      pathname,
      params,
      client,
      idempotent,
      body,
      method: 'DELETE',
      headers,
      signal,
    }
    const res = await request(req.pathname, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function info(params, body, { client, signal, idempotent = true, headers } = {}) {
    const req = {
      pathname: null,
      params,
      client,
      idempotent,
      body,
      method: 'GET',
      headers,
      signal,
    }
    const res = await request(req.pathname, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function up(params, body, { client = defaultClient, signal } = {}) {
    const res = await client.request({
      path: '/_up',
      method: 'GET',
      signal,
      throwOnError: true,
    })
    return await res.body.json()
  }
  async function upsert(pathname, diffFun, { client, signal } = {}) {
    while (true) {
      let doc
      try {
        doc = await get(pathname, null, null, { client, signal })
      } catch (err) {
        if (err.status !== 404) {
          throw err
        }
        doc = {
          _id: pathname.split('/').pop(),
        }
      }

      const docId = doc._id
      const docRev = doc._rev

      const newDoc = diffFun(doc)

      if (!newDoc || (!docRev && newDoc._deleted)) {
        return { updated: false, rev: docRev, id: docId, doc }
      }

      newDoc._id = docId
      newDoc._rev = docRev

      try {
        return {
          ...(await put(pathname, null, newDoc, { client, signal })),
          doc: newDoc,
          updated: true,
        }
      } catch (err) {
        if (err.status !== 409) {
          throw err
        }
      }
    }
  }

  async function close() {
    await defaultClient.close()
    // TODO (fix): Close other clients.
  }

  return {
    get url() {
      return config.url
    },
    request,
    bulkDocs,
    allDocs,
    put,
    post,
    get,
    upsert,
    delete: _delete,
    info,
    changes,
    close,
    up,
  }
}
