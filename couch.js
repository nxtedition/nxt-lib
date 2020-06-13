const { Observable } = require('rxjs')
const querystring = require('querystring')
const urljoin = require('url-join')
const { Pool, Client } = require('undici')
const { Writable } = require('stream')
const EE = require('events')

module.exports = function ({ config, client }) {
  config = config.couchdb || config

  const { protocol, hostname, port, pathname } = new URL(config.url)

  const defaultClient = client || new Pool({ protocol, hostname, port }, {
    connections: config.connections || 16,
    pipelining: config.pipelining || 3
  })

  function onChanges (options) {
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

    params.feed = 'continuous'

    return Observable.create(o => {
      const client = new Client({ protocol, hostname, port })
      let buf = ''
      const subscription = onRequest('/_changes', {
        params,
        body,
        client: options.client || client,
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
        client.destroy(err)
        o.error(err)
      }, () => {
        client.destroy()
        o.complete()
      })

      return () => {
        subscription.unsubscribe()
      }
    })
  }

  function onPut (url, params, body) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    return onRequest(url, {
      params,
      client: defaultClient,
      method: 'PUT',
      headers,
      body
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onPost (url, params, body) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    return onRequest(url, {
      params,
      client: defaultClient,
      method: 'POST',
      headers,
      body
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onGet (url, params) {
    const headers = {
      Accept: 'application/json'
    }

    return onRequest(url, {
      params,
      client: defaultClient,
      method: 'GET',
      headers
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onInfo () {
    const params = {}
    const headers = {
      Accept: 'application/json'
    }

    return onRequest('', {
      params,
      client: defaultClient,
      method: 'GET',
      headers
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onAllDocs (url, options) {
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
      client: defaultClient,
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
    body,
    method,
    headers,
    requestTimeout
  }) {
    return Observable.create(o => {
      const signal = new EE()
      client.stream({
        path: urljoin(pathname, path, `?${querystring.stringify(params || {})}`),
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
          decodeStrings: false,
          write (chunk, encoding, callback) {
            o.next(chunk)
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
    onChanges
  }
}
