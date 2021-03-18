const { Observable } = require('rxjs')
const createError = require('http-errors')

const kListener = Symbol('kListener')
const kSignal = Symbol('kSignal')

function abort(self) {
  self.abort()
}

function addSignal(self, signal) {
  self[kSignal] = null
  self[kListener] = null

  if (!signal) {
    return self
  }

  if (signal.aborted) {
    abort(self)
    return self
  }

  self[kSignal] = signal
  self[kListener] = () => {
    abort(self)
  }

  if ('addEventListener' in self[kSignal]) {
    self[kSignal].addEventListener('abort', self[kListener])
  } else {
    self[kSignal].addListener('abort', self[kListener])
  }

  return self
}

function removeSignal(self) {
  if (!self[kSignal]) {
    return self
  }

  if ('removeEventListener' in self[kSignal]) {
    self[kSignal].removeEventListener('abort', self[kListener])
  } else {
    self[kSignal].removeListener('abort', self[kListener])
  }

  self[kSignal] = null
  self[kListener] = null

  return self
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

  const defaultClient =
    opts.client ??
    new undici.Pool(origin, {
      connections: config.connections || 8,
      pipelining: config.pipelining || 3,
    })

  function onChanges({ client, ...options } = {}) {
    if (client) {
      throw new Error('not supported')
    }

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

    // TODO (fix): Allow other modes.
    params.feed = 'continuous'
    params.heartbeat = Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3

    return new Observable((o) => {
      // Continuos feed never ends even with limit.
      // Limit 0 is the same as 1.
      const limit = params.limit != null ? params.limit || 1 : Infinity

      const client = new undici.Client(origin, {
        bodyTimeout: 2 * (Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3),
      })

      // TODO (fix): client.dispatch + backpressure with node streams instead of rxjs observable.
      client.dispatch(
        {
          // TODO (fix): What if pathname or params is empty?
          path: urljoin(pathname, '/_changes', `?${querystring.stringify(params || {})}`),
          idempotent: true,
          method,
          body,
        },
        {
          status: null,
          data: '',
          count: 0,
          onConnect() {
            // Do nothing...
          },
          onHeaders(statusCode, headers) {
            this.status = statusCode

            if (params.feed === 'continuous' && (statusCode < 200 || statusCode >= 300)) {
              throw createError(statusCode, { headers })
            }
          },
          onData(chunk) {
            this.data += chunk
            const lines = this.data.split(/(?<!\\)\n/)
            this.data = lines.pop()
            for (const line of lines) {
              if (line) {
                this.count += 1
                o.next(JSON.parse(line))
                if (this.count === limit) {
                  o.complete()
                }
              } else {
                o.next(null)
              }
            }
          },
          onComplete() {
            o.complete()
          },
          onError(err) {
            o.error(err)
          },
        }
      )

      return () => {
        client.destroy()
      }
    })
  }

  function request(
    path,
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
      headers = ['Accept', 'application/json']
      if (body) {
        headers.push('Content-Type', 'application/json')
      }
    }

    return new Promise((resolve, reject) =>
      client.dispatch(
        {
          // TODO (fix): What if pathname or params is empty?
          path: urljoin(pathname, path || '', `?${querystring.stringify(params || {})}`),
          idempotent,
          method,
          body: typeof body === 'object' && body ? JSON.stringify(body) : body,
          headers,
        },
        addSignal(
          {
            resolve,
            reject,
            status: null,
            abort: null,
            data: '',
            onConnect(abort) {
              this.abort = abort
            },
            onHeaders(statusCode) {
              this.status = statusCode
            },
            onData(chunk) {
              this.data += chunk
            },
            onComplete() {
              removeSignal(this)

              try {
                this.resolve({
                  data: this.data ? JSON.parse(this.data) : this.data,
                  status: this.status,
                })
              } catch (err) {
                this.reject(err)
              }
            },
            onError(err) {
              removeSignal(this)

              this.reject(err)
            },
          },
          signal
        )
      )
    )
  }

  async function bulkDocs(path, body, { client, signal, idempotent = true } = {}) {
    const res = await request(path, {
      client,
      idempotent,
      body,
      method: 'POST',
      signal,
    })

    if (res.status !== 201) {
      throw createError(res.status, { headers: res.headers })
    }

    return res.data
  }

  async function allDocs(path, { client, signal, idempotent = true, ...options } = {}) {
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

    const res = await request(path, {
      params,
      client,
      idempotent,
      body,
      method,
      headers,
      signal,
    })

    if (res.status !== 200) {
      throw createError(res.status, { headers: res.headers })
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
      throw createError(res.status, { headers: res.headers })
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
      throw createError(res.status, { headers: res.headers })
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
      throw createError(res.status, { headers: res.headers })
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
      throw createError(res.status, { headers: res.headers })
    }

    return res.data
  }

  async function info(path, params, body, { client, signal, idempotent = true, headers } = {}) {
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
      throw createError(res.status, { headers: res.headers })
    }

    return res.data
  }

  return {
    request,
    bulkDocs,
    allDocs,
    put,
    post,
    get,
    delete: _delete,
    info,
    onChanges, // TODO (fix): Deprecate...
    createClient(url, options) {
      return new undici.Pool(url || origin, options)
    },
  }
}
