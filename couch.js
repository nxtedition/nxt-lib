const createError = require('http-errors')
const makeWeak = require('./weakCache')
const tp = require('timers/promises')

let rxjs

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

module.exports = function (opts) {
  const querystring = require('querystring')
  const urljoin = require('url-join')
  const undici = require('undici')

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
    Array.isArray(config.url) ? config.url[0] : config.url
  )

  const defaultClientOpts = {
    keepAliveTimeout: 2 * 60e3,
    headersTimeout: 10 * 60e3,
    bodyTimeout: 2 * 60e3,
    connections: 256,
  }

  const defaultClient = new undici.Pool(dbOrigin, defaultClientOpts)

  const getClient =
    config.getClient ??
    makeWeak(
      () =>
        new undici.Pool(dbOrigin, {
          ...defaultClientOpts,
          connections: 4, // TODO (fix): Global limit?
          pipelining: 4,
        })
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

  async function* changes({ client = defaultClient, signal, ...options } = {}) {
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

    if (typeof options.since !== 'undefined') {
      params.since = options.since || 0
    }

    if (typeof options.style !== 'undefined') {
      params.style = options.style
    }

    if (typeof options.view !== 'undefined') {
      params.view = options.view
    }

    if (typeof options.filter !== 'undefined') {
      params.filter = options.filter
    }

    if (typeof options.heartbeat !== 'undefined') {
      params.heartbeat = options.heartbeat
    } else {
      params.heartbeat = 10e3
    }

    if (typeof options.timeout !== 'undefined') {
      params.timeout = options.timeout
    } else {
      params.timeout = parseInt(params.heartbeat) * 4
    }

    if (typeof options.limit !== 'undefined') {
      params.limit = options.limit
    }

    if (typeof options.doc_ids !== 'undefined') {
      method = 'POST'
      body = { doc_ids: options.doc_ids }
    }

    if (dbPathname === '/') {
      throw new Error('invalid pathname')
    }

    const batched = options.batched || false
    const live = options.live == null || !!options.live
    const retry = options.retry

    // 'normal' feed options
    const batchSize = options.batch_size ?? options.batchSize ?? (params.include_docs ? 256 : 1024)
    let remaining = parseInt(options.limit) || Infinity

    let retryCount = 0

    const ac = new AbortController()
    const onAbort = () => {
      ac.abort()
    }

    if (signal) {
      if (signal.aborted) {
        ac.abort()
      } else {
        if (signal.on) {
          signal.on('abort', onAbort)
        } else if (signal.addEventListener) {
          signal.addEventListener('abort', onAbort)
        }
      }
    }

    async function* continuous() {
      const req = {
        path:
          dbPathname +
          '/_changes' +
          `?${new URLSearchParams({
            ...params,
            ...options.query,
            feed: 'continuous',
          })}`,
        idempotent: true,
        blocking: true,
        method,
        body,
        signal: ac.signal,
        highWaterMark: 128 * 1024, // TODO (fix): Needs support in undici...
      }
      const res = await client.request(req)

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw makeError(req, {
          status: res.statusCode,
          headers: res.headers,
          data: await res.body.text(),
        })
      }

      let str = ''
      for await (const chunk of res.body) {
        retryCount = 0

        str += chunk

        const lines = str.split('\n') // TODO (perf): Avoid extra array allocation.
        str = lines.pop()

        const results = batched ? [] : null
        for (const line of lines) {
          if (line) {
            const change = JSON.parse(line)
            params.since = change.seq
            if (results) {
              results.push(change)
            } else {
              yield change
            }
          }
        }

        if (results && results.length) {
          yield results
        }
      }
    }

    async function* normal() {
      while (remaining) {
        const req = {
          path:
            dbPathname +
            '/_changes' +
            `?${new URLSearchParams({
              ...params,
              ...options.query,
              limit: Math.min(remaining, batchSize),
              feed: live ? 'continuous' : 'normal',
            })}`,
          idempotent: true,
          blocking: live,
          method,
          body,
          signal: ac.signal,
        }
        const res = await client.request(req)

        if (res.statusCode < 200 || res.statusCode >= 300) {
          throw makeError(req, {
            status: res.statusCode,
            headers: res.headers,
            data: await res.body.text(),
          })
        }

        const { last_seq: seq, results } = await res.body.json()
        retryCount = 0

        params.since = seq
        remaining -= results.length

        if (results.length === 0) {
          return
        }

        if (batched) {
          yield results
        } else {
          yield* results
        }
      }
    }

    try {
      while (true) {
        try {
          if (live) {
            yield* continuous()
          } else {
            yield* normal()
          }
          return
        } catch (err) {
          if (retry && err.name !== 'AbortError' && err.code !== 'UND_ERR_ABORTED') {
            Object.assign(params, await retry(err, retryCount++, params))
          } else {
            throw err
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

  function onChanges(options) {
    if (!rxjs) {
      rxjs = require('rxjs')
    }

    return new rxjs.Observable((o) => {
      const ac = new AbortController()
      async function run() {
        try {
          for await (const change of changes({ ...options, signal: ac.signal })) {
            o.next(change)
          }
          o.complete()
        } catch (err) {
          o.error(err)
        }
      }

      run()

      return () => {
        ac.abort()
      }
    })
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
    { params, client = defaultClient, idempotent, body, method, headers, signal }
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

    let path = dbPathname

    if (url) {
      path = urljoin(path, encodeURI(url))
    }

    if (params) {
      path += `?${querystring.stringify(params)}`
    }

    return new Promise((resolve, reject) =>
      client.dispatch(
        {
          path,
          origin: dbOrigin,
          idempotent,
          method,
          body: typeof body === 'object' && body ? JSON.stringify(body) : body,
          headers,
        },
        {
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

            this.resolve({
              data,
              status: this.status,
              headers: this.headers,
            })
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
        }
      )
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

    if (options.sorted) {
      params.sorted = true
    }

    if (options.key) {
      params.key = JSON.stringify(options.key)
    }

    if (options.start_key) {
      options.startkey = options.start_key
    }

    if (options.startkey) {
      params.startkey = JSON.stringify(options.startkey)
    }

    if (options.startkey_docid) {
      params.startkey_docid = JSON.stringify(options.startkey_docid)
    }

    if (options.end_key) {
      options.endkey = options.end_key
    }

    if (options.endkey) {
      params.endkey = JSON.stringify(options.endkey)
    }

    if (typeof options.inclusive_end !== 'undefined') {
      params.inclusive_end = !!options.inclusive_end
    }

    if (typeof options.limit !== 'undefined') {
      params.limit = options.limit
    }

    if (typeof options.skip !== 'undefined') {
      params.skip = options.skip
    }

    if (typeof options.stale !== 'undefined') {
      params.stale = options.stale
    }

    if (typeof options.reduce !== 'undefined') {
      params.reduce = options.reduce
    }

    if (typeof options.group !== 'undefined') {
      params.group = options.group
    }

    if (typeof options.group_level !== 'undefined') {
      params.group_level = options.group_level
    }

    if (typeof options.keys !== 'undefined') {
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
    { client = getClient('_all_docs'), signal, idempotent = true, headers } = {}
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
    { client, signal, idempotent = true, headers } = {}
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

  return {
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
    onChanges, // TODO: deprecate
  }
}
