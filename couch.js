const { Observable } = require('rxjs')
const querystring = require('querystring')
const urljoin = require('url-join')
const { Writable } = require('stream')
const EE = require('events')

let undici

module.exports = function ({ config }) {
  config = config.couchdb || config

  const { protocol, hostname, port, pathname } = new URL(config.url)

  function createClient (...args) {
    if (!undici) undici = require('undici')
    return new undici.Client(...args)
  }

  function createPool (...args) {
    if (!undici) undici = require('undici')
    return new undici.Pool(...args)
  }

  const defaultClient = createPool({ protocol, hostname, port }, {
    connections: config.connections || 8,
    socketTimeout: config.socketTimeout || 30e3,
    requestTimeout: config.requestTimeout || 30e3,
    pipelining: config.pipelining || 3
  })

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

    return Observable.create(o => {
      const userClient = options.client
      const client = userClient || createClient({
        protocol,
        hostname,
        port
      }, {
        socketTimeout: 2 * (Number.isFinite(params.heartbeat) ? params.heartbeat : 30e3)
      })
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
              } else {
                o.next(change)
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

  function onPut (url, params, body, options = {}) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    return onRequest(url, {
      params,
      client: options.client,
      idempotent: true,
      method: 'PUT',
      headers,
      body
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onPost (url, params, body, { client } = {}) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    // TODO (fix): idempotent?
    return onRequest(url, {
      params,
      client,
      method: 'POST',
      headers,
      body
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onGet (url, params, options = {}) {
    const headers = {
      Accept: 'application/json'
    }

    return onRequest(url, {
      params,
      client: options.client,
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
      client: options.cleint,
      idempotent: true,
      method: 'GET',
      headers
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onAllDocs (url, options = {}) {
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

    return onRequest(url, {
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
    headers,
    requestTimeout
  }) {
    client = client || defaultClient
    return Observable.create(o => {
      const signal = new EE()
      client.stream({
        // TODO (fix): What if pathname or params is empty?
        path: urljoin(pathname, path, `?${querystring.stringify(params || {})}`),
        idempotent,
        method,
        signal,
        body: body ? JSON.stringify(body) : null,
        requestTimeout,
        headers
      }, ({ statusCode }) => {
        if (statusCode < 200 || statusCode >= 300) {
          const err = new Error(statusCode)
          err.statusCode = statusCode
          throw err
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
    onAllDocs,
    onPut,
    onPost,
    onGet,
    onInfo,
    onChanges,
    protocol,
    hostname,
    port
  }
}
