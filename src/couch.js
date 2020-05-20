const http = require('http')
const { Observable } = require('rxjs')
const once = require('once')
const querystring = require('querystring')
const urljoin = require('url-join')

module.exports = function ({ config, agent }) {
  const defaultAgent = agent || new http.Agent({
    keepAlive: config.couchdb.keepAlive,
    timeout: config.couchdb.timeout || 2 * 60e3,
    maxSockets: config.couchdb.maxSockets || 256,
    maxFreeSockets: config.couchdb.maxFreeSockets || 256
  })

  function onChanges (options) {
    const params = {}
    const headers = {
      Accept: 'application/json'
    }

    const url = '/_changes'
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
      params.since = options.since
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
      let buf = ''
      const subscription = onRequest(url, {
        params,
        body,
        method,
        headers
      }).subscribe(data => {
        buf += data
        const lines = buf.split(/(?<!\\)\n/)
        buf = lines.pop()
        try {
          for (const line of lines) {
            if (line) {
              o.next(JSON.parse(line))
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
      }
    })
  }

  function onPut (url, body) {
    const params = {}
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    return onRequest(url, {
      params,
      agent: defaultAgent,
      method: 'PUT',
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
      agent: defaultAgent,
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
      agent: defaultAgent,
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
      agent: defaultAgent,
      body,
      method,
      headers
    })
      .reduce((body, data) => body + data, '')
      .map(body => JSON.parse(body))
  }

  function onRequest (url, {
    params,
    agent,
    body,
    method,
    headers,
    timeout
  }) {
    return Observable.create(o => {
      const callback = once(err => err ? o.error(err) : o.complete())

      const req = http
        .request(urljoin(config.couchdb.url, url, `?${querystring.stringify(params)}`), {
          method,
          agent,
          timeout,
          headers
        })
        .on('error', callback)
        .on('timeout', () => callback(new Error('timeout')))
        .on('response', res => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(res.statusCode)
            err.statusCode = res.statusCode
            callback(err)
          } else {
            res
              .setEncoding('utf-8')
              .on('error', callback)
              .on('aborted', () => callback(new Error('aborted')))
              .on('data', buf => {
                o.next(buf)
              })
              .on('end', () => {
                callback()
              })
          }
        })
        .end(body ? JSON.stringify(body) : null)

      return () => {
        req.abort()
      }
    })
  }

  return {
    onAllDocs,
    onPut,
    onGet,
    onInfo,
    onChanges
  }
}
