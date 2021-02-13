const { Observable } = require('rxjs')
const { Writable } = require('stream')
const EE = require('events')
const createError = require('http-errors')

let urljoin
let querystring
let undici

module.exports = function (opts) {
  let config
  if (typeof opts === 'string') {
    config = { url: opts }
  } else if (opts.url) {
    config = opts
  } else if (opts.config) {
    config = opts.config.couchdb || opts.config
  } else {
    throw new Error('invalid options')
  }

  if (typeof config === 'string') {
    config = { url: config }
  }

  const { protocol, hostname, port, pathname } = new URL(config.url)

  function createClient (...args) {
    if (!undici) undici = require('undici')
    return new undici.Client(...args)
  }

  function createPool (...args) {
    if (!undici) undici = require('undici')
    return new undici.Pool(...args)
  }

  let defaultClient = opts.client

  function onChanges (options = {}) {
    const params = {}
    const headers = {
      Accept: 'application/json'
    }

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
      headers['Content-Type'] = 'application/json'
    }

    // TODO (fix): Allow other modes.
    params.feed = 'continuous'
    params.heartbeat = Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3

    return new Observable(o => {
      // Continuos feed never ends even with limit.
      // Limit 0 is the same as 1.
      const limit = params.limit != null ? (params.limit || 1) : Infinity

      const userClient = options.client
      const client = userClient || createClient({
        protocol,
        hostname,
        port
      }, {
        bodyTimeout: 2 * (Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3)
      })
      let count = 0
      let buf = ''
      const subscription = onRequest('/_changes', {
        params,
        body,
        client,
        idempotent: true,
        method,
        headers
      }).subscribe(data => {
        buf += data
        const lines = buf.split(/(?<!\\)\n/)
        buf = lines.pop()
        try {
          for (const line of lines) {
            if (line) {
              const change = JSON.parse(line)

              if (change.last_seq != null) {
                o.complete()
                return
              }

              o.next(change)

              count += 1
              if (count === limit) {
                o.complete()
                return
              }
            } else {
              o.next(null)
            }
          }
        } catch (err) {
          o.error(err)
        }
      }, err => {
        o.error(err)
      }, () => {
        o.complete()
      })

      return () => {
        subscription.unsubscribe()
        if (client !== userClient) {
          client.destroy()
        }
      }
    })
  }

  function onPut (path, params, body, { client, idempotent = true } = {}) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    return onRequest(path, {
      params,
      client,
      idempotent,
      method: 'PUT',
      headers,
      body
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onPost (path, params, body, { client, idempotent = false } = {}) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    // TODO (fix): idempotent?
    return onRequest(path, {
      params,
      client,
      idempotent,
      method: 'POST',
      headers,
      body
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onGet (path, params, { client } = {}) {
    const headers = {
      Accept: 'application/json'
    }

    return onRequest(path, {
      params,
      client,
      idempotent: true,
      method: 'GET',
      headers
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onInfo (options = {}) {
    const params = {}
    const headers = {
      Accept: 'application/json'
    }

    return onRequest('', {
      params,
      client: options.client,
      idempotent: true,
      method: 'GET',
      headers
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onAllDocs (path, options = {}) {
    const params = {}
    const headers = {
      Accept: 'application/json'
    }

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
      headers['Content-Type'] = 'application/json'
    }

    return onRequest(path, {
      params,
      client: options.client,
      idempotent: true,
      body,
      method,
      headers
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onRequest (path, {
    params,
    client,
    idempotent,
    body,
    method,
    headers
  }) {
    if (!querystring) querystring = require('querystring')
    if (!urljoin) urljoin = require('url-join')

    if (!client) {
      if (!defaultClient) {
        defaultClient = createPool({ protocol, hostname, port }, {
          connections: config.connections || 8,
          pipelining: config.pipelining || 3
        })
      }
      client = defaultClient
    }

    if (!body) {
      body = null
    } else if (typeof body !== 'string') {
      body = JSON.stringify(body)
    }

    return new Observable(o => {
      const signal = new EE()
      client.stream({
        // TODO (fix): What if pathname or params is empty?
        path: urljoin(pathname, path, `?${querystring.stringify(params || {})}`),
        idempotent,
        method,
        signal,
        body,
        headers
      }, ({ statusCode }) => {
        if (statusCode < 200 || statusCode >= 300) {
          throw createError(statusCode, { headers })
        }
        return new Writable(({
          write (chunk, encoding, callback) {
            o.next(chunk.toString())
            callback()
          }
        }))
      }, (err) => {
        if (err) {
          o.error(err)
        } else {
          o.complete()
        }
      })
      return () => {
        signal.emit('abort')
      }
    })
  }

  return {
    async request (...args) {
      return { body: await onRequest(...args).first().toPromise() }
    },
    async put (...args) {
      return await onPut(...args).first().toPromise()
    },
    async post (...args) {
      return await onPost(...args).first().toPromise()
    },
    async get (...args) {
      return await onGet(...args).first().toPromise()
    },
    info (...args) {
      return onInfo(...args).first().toPromise()
    },
    allDocs (...args) {
      return onAllDocs(...args).first().toPromise()
    },
    onRequest,
    onAllDocs,
    onPut,
    onPost,
    onGet,
    onInfo,
    onChanges,
    createClient (url, options) {
      return createPool(url || { protocol, hostname, port }, options)
    }
  }
}
