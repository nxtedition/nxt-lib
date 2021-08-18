const { Observable } = require('rxjs')
const createError = require('http-errors')
const makeWeak = require('./weakCache')

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

function makeError(res) {
  return createError(res.status, { headers: res.headers, ...res.data })
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

  const getClient =
    config.getClient ??
    makeWeak(
      (key, options) =>
        new undici.Pool(origin, {
          connections: 0,
          pipelining: 1, // TODO (perf): Allow pipelining?
          keepAliveTimeout: 30e3, // TODO (fix): What is correct keep alive timeout?
          ...config.undici,
          ...options,
        })
    )

  const defaultClient = getClient({ pipelining: 1 })

  async function* changes({ client, ...options } = {}) {
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

    if (typeof options.limit !== 'undefined') {
      params.limit = options.limit
    }

    if (typeof options.heartbeat !== 'undefined') {
      params.heartbeat = options.heartbeat
    }

    if (typeof options.timeout !== 'undefined') {
      // TODO (fix): Investigate what this is?
      params.timeout = options.timeout
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

    if (typeof options.doc_ids !== 'undefined') {
      method = 'POST'
      body = { doc_ids: options.doc_ids }
    }

    // TODO (fix): Take heartbeat from client.bodyTimeout.
    params.heartbeat = Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3
    params.feed = options.live == null || options.live ? 'longpoll' : 'poll'

    if (!client) {
      client =
        params.feed === 'normal'
          ? defaultClient
          : new undici.Client(origin, {
              bodyTimeout: 2 * (Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3),
              pipelining: 0,
            })
    }

    if (pathname === '/') {
      throw new Error('invalid pathname')
    }

    let remaining = params.limit || Infinity

    while (true) {
      params.limit = Math.min(remaining, options.batchSize ?? 256)
      const res = await client.request({
        path: pathname + '/_changes' + `?${querystring.stringify(params)}`,
        idempotent: true,
        method,
        body,
      })

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw createError(res.statusCode, {
          headers: res.headers,
          data: await res.body.text(),
        })
      }

      const { last_seq: seq, pending, results } = await res.body.json()

      remaining -= results.length

      params.since = seq

      yield* results

      if (pending === 0) {
        return
      }
    }
  }

  function onChanges(options) {
    return new Observable((o) => {
      const stream = changes(options)
        .on('data', (data) => o.next(data))
        .on('error', (err) => o.error(err))
        .on('end', () => o.complete())

      return () => {
        stream.destroy()
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

  async function bulkDocs(body, { client, signal, idempotent = true } = {}) {
    const res = await request('_bulk_docs', {
      client,
      idempotent,
      body,
      method: 'POST',
      signal,
    })

    if (res.status !== 201) {
      throw makeError(res)
    }

    return res.data
  }

  async function allDocs(path, opts) {
    if (path && typeof path === 'object') {
      opts = path
      path = null
    }

    path = path || '_all_docs'

    const { client = getClient(path), signal, idempotent = true, ...options } = opts ?? {}

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

    const res = await request(path || '_all_docs', {
      params,
      client,
      idempotent,
      body,
      method,
      headers,
      signal,
    })

    if (res.status !== 200) {
      throw makeError(res)
    }

    return res.data
  }

  async function put(path, params, body, { client, signal, idempotent = true, headers } = {}) {
    const res = await request(path, {
      params,
      client,
      idempotent,
      body,
      method: 'PUT',
      headers,
      signal,
    })

    if (res.status < 200 || res.status >= 300) {
      throw makeError(res)
    }

    return res.data
  }

  async function post(path, params, body, { client, signal, idempotent = true, headers } = {}) {
    const res = await request(path, {
      params,
      client,
      idempotent,
      body,
      method: 'POST',
      headers,
      signal,
    })

    if (res.status < 200 || res.status >= 300) {
      throw makeError(res)
    }

    return res.data
  }

  async function get(path, params, body, { client, signal, idempotent = true, headers } = {}) {
    const res = await request(path, {
      params,
      client,
      idempotent,
      body,
      method: 'GET',
      headers,
      signal,
    })

    if (res.status < 200 || res.status >= 300) {
      throw makeError(res)
    }

    return res.data
  }

  async function _delete(path, params, body, { client, signal, idempotent = true, headers } = {}) {
    const res = await request(path, {
      params,
      client,
      idempotent,
      body,
      method: 'DELETE',
      headers,
      signal,
    })

    if (res.status < 200 || res.status >= 300) {
      throw makeError(res)
    }

    return res.data
  }

  async function info(params, body, { client, signal, idempotent = true, headers } = {}) {
    const res = await request(null, {
      params,
      client,
      idempotent,
      body,
      method: 'GET',
      headers,
      signal,
    })

    if (res.status < 200 || res.status >= 300) {
      throw makeError(res)
    }

    return res.data
  }

  async function upsert(path, diffFun) {
    while (true) {
      let doc
      try {
        doc = await get(path)
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
        return { updated: false, rev: docRev, id: docId }
      }

      newDoc._id = docId
      newDoc._rev = docRev

      try {
        return await put(path, null, newDoc)
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
