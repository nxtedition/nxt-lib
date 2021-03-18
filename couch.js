const { Observable } = require('rxjs')
const { Readable } = require('stream')
const createError = require('http-errors')
const makeWeak = require('./weakCache')

function parseHeaders(headers, obj = {}) {
  for (let i = 0; i < headers.length; i += 2) {
    const key = headers[i].toLowerCase()
    let val = obj[key]
    if (!val) {
      obj[key] = headers[i + 1]
    } else {
      if (!Array.isArray(val)) {
        val = [val]
        obj[key] = val
      }
      val.push(headers[i + 1])
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

  const getClient = makeWeak(
    () =>
      new undici.Pool({
        connections: 0,
        pipelining: 3,
      })
  )

  const { origin, pathname } = new URL(Array.isArray(config.url) ? config.url[0] : config.url)

  const defaultClient = new undici.Pool(origin, {
    connections: 0,
    pipelining: 1,
  })

  function changes({ client, ...options } = {}) {
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

    // TODO (fix): Take heartbeat from client.bodyTimeout.
    params.heartbeat = Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3

    // Continuos feed never ends even with limit.
    // Limit 0 is the same as 1.
    const limit = params.limit != null ? params.limit || 1 : Infinity

    if (!client) {
      client = new undici.Client(origin, {
        bodyTimeout: 2 * (Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3),
        pipelining: 0,
      })
    }

    const readable = new Readable({
      objectMode: true,
      read() {},
    })

    client.dispatch(
      {
        // TODO (fix): What if pathname or params is empty?
        path: urljoin(pathname, '/_changes', `?${querystring.stringify(params || {})}`),
        idempotent: false,
        method,
        body,
      },
      {
        readable,
        status: null,
        headers: null,
        data: '',
        count: 0,
        onConnect(abort) {
          if (this.readable.destroyed) {
            abort()
          } else {
            this.readable._destroy = abort
          }
          // Do nothing...
        },
        onHeaders(statusCode, headers, resume) {
          this.readable._read = resume
          this.status = statusCode
          this.headers = parseHeaders(headers)

          if (params.feed === 'continuous' && (statusCode < 200 || statusCode >= 300)) {
            throw createError(statusCode, { headers })
          }
        },
        onData(chunk) {
          this.data += chunk
          const lines = this.data.split(/(?<!\\)\n/)
          this.data = lines.pop()

          let running = true
          for (const line of lines) {
            if (line) {
              this.count += 1
              running = running && this.readable.push(JSON.parse(line))
              if (this.count === limit) {
                this.readable.push(null)
              }
            }
          }

          return running
        },
        onComplete() {
          this.readable.push(null)
        },
        onError(err) {
          this.readable.destroy(err)
        },
      }
    )

    return readable
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

  return {
    request,
    bulkDocs,
    allDocs,
    put,
    post,
    get,
    delete: _delete,
    info,
    changes,
    onChanges, // TODO: deprecate
    createClient(url, options) {
      // TODO: deprecate
      return new undici.Pool(url || origin, options)
    },
  }
}
