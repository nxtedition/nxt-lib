const assert = require('assert')
const createError = require('http-errors')
const xuid = require('xuid')
const undici = require('undici')
const stream = require('stream')
const { parseHeaders } = require('../http')

class Readable extends stream.Readable {
  constructor({ statusCode, statusMessage, headers, ...opts }) {
    super(opts)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
    this.headers = headers
    this.body = this
  }

  async text() {
    const dec = new TextDecoder()
    let str = ''
    for await (const chunk of this) {
      if (typeof chunk === 'string') {
        str += chunk
      } else {
        str += dec.decode(chunk, { stream: true })
      }
    }
    // Flush the streaming TextDecoder so that any pending
    // incomplete multibyte characters are handled.
    str += dec.decode(undefined, { stream: false })
    return str
  }

  async json() {
    return JSON.parse(await this.text())
  }

  async arrayBuffer() {
    const buffers = []
    for await (const chunk of this) {
      buffers.push(chunk)
    }
    return Buffer.concat(buffers)
  }

  async buffer() {
    return Buffer.from(await this.arrayBuffer())
  }

  async dump() {
    let n = 0
    try {
      for await (const chunk of this) {
        // do nothing
        n += chunk.length
        if (n > 128 * 1024) {
          break
        }
      }
    } catch {
      this.destroy()
    }
  }
}

const dispatchers = {
  abort: require('./interceptor/abort.js'),
  catch: require('./interceptor/catch.js'),
  content: require('./interceptor/content.js'),
  responseBodyDump: require('./interceptor/response-body-dump.js'),
  log: require('./interceptor/log.js'),
  redirect: require('./interceptor/redirect.js'),
  responseBodyRetry: require('./interceptor/response-body-retry.js'),
  responseStatusRetry: require('./interceptor/response-status-retry.js'),
  responseRetry: require('./interceptor/response-retry.js'),
  signal: require('./interceptor/signal.js'),
  proxy: require('./interceptor/proxy.js'),
}

async function request(urlOrOpts, opts = {}) {
  let url
  if (typeof urlOrOpts === 'string') {
    url = new URL(urlOrOpts)
  } else if (urlOrOpts instanceof URL) {
    url = urlOrOpts
  } else if (typeof urlOrOpts?.origin === 'string' && typeof urlOrOpts?.path === 'string') {
    url = urlOrOpts
  } else if (typeof urlOrOpts === 'object' && urlOrOpts != null) {
    opts = urlOrOpts
    url = opts.url
  }

  const method = opts.method ?? (opts.body ? 'POST' : 'GET')
  const idempotent = opts.idempotent ?? (method === 'GET' || method === 'HEAD')
  const dump = opts.dump ?? method === 'HEAD'

  let headers
  if (Array.isArray(opts.headers)) {
    headers = parseHeaders(opts.headers)
  } else {
    headers = opts.headers
  }

  opts = {
    url,
    method,
    body: opts.body,
    headers: {
      'request-id': xuid(),
      'user-agent': opts.userAgent ?? globalThis.userAgent,
      ...headers,
    },
    origin: opts.origin ?? url.origin,
    path: opts.path ?? url.search ? `${url.pathname}${url.search ?? ''}` : url.pathname,
    reset: opts.reset ?? false,
    headersTimeout: opts.headersTimeout,
    bodyTimeout: opts.bodyTimeout,
    idempotent,
    signal: opts.signal,
    retry: opts.retry ?? 8,
    follow: { count: opts.maxRedirections ?? 8, ...opts.redirect, ...opts.follow },
    dump,
    logger: opts.logger,
  }

  const dispatcher = opts.dispatcher ?? undici.getGlobalDispatcher()

  return new Promise((resolve) => {
    let dispatch = (opts, handler) => dispatcher.dispatch(opts, handler)

    dispatch = dispatchers.catch(dispatch)
    dispatch = dispatchers.abort(dispatch)
    dispatch = dispatchers.log(dispatch)
    dispatch = dispatchers.responseRetry(dispatch)
    dispatch = dispatchers.responseStatusRetry(dispatch)
    dispatch = dispatchers.responseBodyRetry(dispatch)
    dispatch = dispatchers.content(dispatch)
    dispatch = dispatchers.responseBodyDump(dispatch)
    dispatch = dispatchers.redirect(dispatch)
    dispatch = dispatchers.signal(dispatch)
    dispatch = dispatchers.proxy(dispatch)

    dispatch(opts, {
      resolve,
      /** @type {Function | null} */ abort: null,
      /** @type {stream.Readable | null} */ body: null,
      onConnect(abort) {
        this.abort = abort
      },
      onHeaders(statusCode, rawHeaders, resume, statusMessage) {
        assert(this.abort)

        const headers = parseHeaders(rawHeaders)

        if (statusCode >= 400) {
          this.abort(createError(statusCode, { headers }))
        } else {
          assert(statusCode >= 200)

          this.body = new Readable({
            read: resume,
            highWaterMark: 128 * 1024,
            statusCode,
            statusMessage,
            headers,
          })

          this.resolve(this.body)
          this.resolve = null
        }

        return false
      },
      onData(chunk) {
        assert(this.body)
        return this.body.push(chunk)
      },
      onComplete() {
        assert(this.body)
        this.body.push(null)
      },
      onError(err) {
        if (this.body) {
          this.body.destroy(err)
        } else {
          this.resolve(Promise.reject(err))
        }
      },
    })
  })
}

module.exports = { request }
