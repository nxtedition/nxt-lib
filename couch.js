const createError = require('http-errors')
const makeWeak = require('./weakCache')

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

  const { origin, pathname } = new URL(Array.isArray(config.url) ? config.url[0] : config.url)

  const defaultClient = new undici.Pool(origin, {
    keepAliveTimeout: 30e3,
    headersTimeout: 2 * 60e3,
    connections: 256,
  })

  const getClient =
    config.getClient ??
    makeWeak(
      () =>
        new undici.Pool(origin, {
          connections: 4, // TODO (fix): Global limit?
          pipelining: 8, // TODO (perf): Allow pipelining?
          keepAliveTimeout: 30e3,
          headersTimeout: 2 * 60e3,
        })
    )

  function makeError(req, res) {
    let path = pathname

    if (req.path) {
      path = urljoin(path, req.path)
    }

    if (req.params) {
      path += `?${querystring.stringify(req.params)}`
    }

    return createError(res.status, {
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
    })
  }

  async function* changes({ client, signal, ...options } = {}) {
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

    if (typeof options.doc_ids !== 'undefined') {
      method = 'POST'
      body = { doc_ids: options.doc_ids }
    }

    if (pathname === '/') {
      throw new Error('invalid pathname')
    }

    const batched = options.batched || false
    const live = options.live == null || !!options.live
    const retry = options.retry

    let retryCount = 0
    let remaining = parseInt(options.limit) || Infinity

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

    const next = async () => {
      if (!remaining) {
        return
      }

      while (true) {
        try {
          const req = {
            path:
              pathname +
              '/_changes' +
              `?${new URLSearchParams({
                ...params,
                ...options.query,
                heartbeat: Number.isFinite(params.heartbeat) ? params.heartbeat : 10e3,
                limit: Math.min(
                  remaining,
                  options.batch_size ?? options.batchSize ?? (params.include_docs ? 256 : 1024)
                ),
                feed: live ? 'longpoll' : 'normal',
              })}`,
            idempotent: true,
            // blocking: live,
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

          // TODO (perf): Read last_seq first and then parse rest of body.
          const json = await res.body.json()

          retryCount = 0

          params.since = json.last_seq
          remaining -= json.results.length

          return json
        } catch (err) {
          if (retry && err.name !== 'AbortError') {
            await retry(err, retryCount++)
          } else {
            return { err }
          }
        }
      }
    }

    try {
      if (!client) {
        // TODO (fix): Remove when we have blocking support in undici.
        client = live ? new undici.Pool(origin) : getClient('_changes')
      }

      let promise = next()
      while (true) {
        const res = await promise

        if (!res) {
          return
        }

        const { results, err } = res

        if (err) {
          throw err
        }

        promise = next()

        // Ensure request has been dispatched.
        await Promise.resolve()

        if (batched) {
          yield results
        } else {
          yield* results
        }

        if (!live && results.length === 0) {
          return
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

  function request(
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

    let path = pathname

    if (url) {
      path = urljoin(path, url)
    }

    if (params) {
      path += `?${querystring.stringify(params)}`
    }

    return new Promise((resolve, reject) =>
      client.dispatch(
        {
          path,
          origin,
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

            this.resolve({
              data: this.data ? JSON.parse(this.data) : this.data,
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
      path: '_bulk_docs',
      client,
      idempotent,
      body,
      method: 'POST',
      signal,
    }
    const res = await request(req.path, req)

    if (res.status !== 201) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function allDocs(path, opts = {}) {
    if (path && typeof path === 'object') {
      opts = path
      path = null
    }

    path = path || '_all_docs'

    const { client = getClient(path), signal, idempotent = true, ...options } = opts

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

    if (typeof options.keys !== 'undefined') {
      method = 'POST'
      body = { keys: options.keys }
      headers.push('Content-Type', 'application/json')
    }

    const req = {
      path: path || '_all_docs',
      params,
      client,
      idempotent,
      body,
      method,
      headers,
      signal,
    }
    const res = await request(req.path, req)

    if (res.status !== 200) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function put(path, params, body, { client, signal, idempotent = true, headers } = {}) {
    const req = {
      path,
      params,
      client,
      idempotent,
      body,
      method: 'PUT',
      headers,
      signal,
    }
    const res = await request(req.path, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function post(path, params, body, opts = {}) {
    const { client, signal, idempotent = true, headers } = opts
    const req = {
      path,
      params,
      client,
      idempotent,
      body,
      method: 'POST',
      headers,
      signal,
    }
    const res = await request(req.path, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function get(
    path,
    params,
    body,
    { client = getClient('_all_docs'), signal, idempotent = true, headers } = {}
  ) {
    const req = {
      path,
      params,
      client,
      idempotent,
      body,
      method: 'GET',
      headers,
      signal,
    }
    const res = await request(req.path, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function _delete(path, params, body, { client, signal, idempotent = true, headers } = {}) {
    const req = {
      path,
      params,
      client,
      idempotent,
      body,
      method: 'DELETE',
      headers,
      signal,
    }
    const res = await request(req.path, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function info(params, body, { client, signal, idempotent = true, headers } = {}) {
    const req = {
      path: null,
      params,
      client,
      idempotent,
      body,
      method: 'GET',
      headers,
      signal,
    }
    const res = await request(req.path, req)

    if (res.status < 200 || res.status >= 300) {
      throw makeError(req, res)
    }

    return res.data
  }

  async function upsert(path, diffFun, { client, signal } = {}) {
    while (true) {
      let doc
      try {
        doc = await get(path, null, null, { client, signal })
      } catch (err) {
        if (err.status !== 404) {
          throw err
        }
        doc = {
          _id: path.split('/').pop(),
        }
      }

      const docId = doc._id
      const docRev = doc._rev

      const newDoc = diffFun(doc)

      if (!newDoc) {
        return { updated: false, rev: docRev, id: docId, doc }
      }

      newDoc._id = docId
      newDoc._rev = docRev

      try {
        return {
          ...(await put(path, null, newDoc, { client, signal })),
          doc: newDoc,
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
