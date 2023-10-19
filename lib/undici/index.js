const assert = require('assert')
const createError = require('http-errors')
const xuid = require('xuid')
const undici = require('undici')
const stream = require('stream')
const { parseHeaders } = require('../../http')

class Readable extends stream.Readable {
  constructor({ statusCode, statusMessage, headers, size, ...opts }) {
    super(opts)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
    this.headers = headers
    this.body = this
    this.size = size
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
  log: require('./interceptor/log.js'),
  redirect: require('./interceptor/redirect.js'),
  responseBodyRetry: require('./interceptor/response-body-retry.js'),
  responseStatusRetry: require('./interceptor/response-status-retry.js'),
  responseRetry: require('./interceptor/response-retry.js'),
  signal: require('./interceptor/signal.js'),
  proxy: require('./interceptor/proxy.js'),
  cache: require('./interceptor/cache.js'),
}

async function request(url, opts) {
  if (typeof url === 'string') {
    url = new URL(url)
  } else if (url instanceof URL) {
    // Do nothing...
  } else if (typeof url.origin === 'string' && typeof (url.path ?? url.pathname) === 'string') {
    // Do nothing...
  } else {
    throw new Error('missing url')
  }

  if (opts == null && typeof url === 'object' && url != null) {
    opts = url
  }

  const method = opts.method ?? (opts.body ? 'POST' : 'GET')
  const idempotent = opts.idempotent ?? (method === 'GET' || method === 'HEAD')

  let headers
  if (Array.isArray(opts.headers)) {
    headers = parseHeaders(opts.headers)
  } else {
    headers = opts.headers
  }

  if (method === 'CONNECT') {
    throw new createError.MethodNotAllowed()
  }

  if (
    (method === 'HEAD' || method === 'GET') &&
    (parseInt(headers['content-length']) > 0 || headers['transfer-encoding'])
  ) {
    throw new createError.BadRequest('HEAD and GET cannot have body')
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
    origin: url.origin,
    path: url.path ? url.path : url.search ? `${url.pathname}${url.search ?? ''}` : url.pathname,
    reset: opts.reset ?? false,
    headersTimeout: opts.headersTimeout,
    bodyTimeout: opts.bodyTimeout,
    idempotent,
    signal: opts.signal,
    retry: opts.retry ?? 8,
    proxy: opts.proxy,
    cache: opts.cache,
    upgrade: opts.upgrade,
    follow: { count: opts.maxRedirections ?? 8, ...opts.redirect, ...opts.follow },
    logger: opts.logger,
    maxRedirections: 0, // Disable undici's redirect handling.
  }

  const expectsPayload = opts.method === 'PUT' || opts.method === 'POST' || opts.method === 'PATCH'

  if (opts.headers['content-length'] === '0' && !expectsPayload) {
    // https://tools.ietf.org/html/rfc7230#section-3.3.2
    // A user agent SHOULD NOT send a Content-Length header field when
    // the request message does not contain a payload body and the method
    // semantics do not anticipate such a body.

    // undici will error if provided an unexpected content-length: 0 header.
    delete opts.headers['content-length']
  }

  const dispatcher = opts.dispatcher ?? undici.getGlobalDispatcher()

  return new Promise((resolve) => {
    let dispatch = (opts, handler) => dispatcher.dispatch(opts, handler)

    dispatch = dispatchers.catch(dispatch)
    dispatch = dispatchers.abort(dispatch)
    dispatch = dispatchers.log(dispatch)
    dispatch = opts.upgrade ? dispatch : dispatchers.responseRetry(dispatch)
    dispatch = opts.upgrade ? dispatch : dispatchers.responseStatusRetry(dispatch)
    dispatch = opts.upgrade ? dispatch : dispatchers.responseBodyRetry(dispatch)
    dispatch = opts.upgrade ? dispatch : dispatchers.content(dispatch)
    dispatch = dispatchers.redirect(dispatch)
    dispatch = dispatchers.signal(dispatch)
    dispatch = opts.upgrade ? dispatch : dispatchers.cache(dispatch)
    dispatch = dispatchers.proxy(dispatch)

    dispatch(opts, {
      resolve,
      logger: opts.logger,
      /** @type {Function | null} */ abort: null,
      /** @type {stream.Readable | null} */ body: null,
      onConnect(abort) {
        this.abort = abort
      },
      onUpgrade(statusCode, rawHeaders, socket) {
        const headers = parseHeaders(rawHeaders)

        if (statusCode !== 101) {
          this.abort(createError(statusCode, { headers }))
        } else {
          this.resolve({ headers, socket })
        }
      },
      onHeaders(statusCode, rawHeaders, resume, statusMessage) {
        assert(this.abort)

        const headers = parseHeaders(rawHeaders)

        if (statusCode >= 400) {
          this.abort(createError(statusCode, { headers }))
        } else {
          assert(statusCode >= 200)

          const contentLength = Number(headers['content-length'] ?? headers['Content-Length'])

          this.body = new Readable({
            read: resume,
            highWaterMark: 128 * 1024,
            statusCode,
            statusMessage,
            headers,
            size: Number.isFinite(contentLength) ? contentLength : null,
          }).on('error', (err) => {
            if (this.logger && this.body?.listenerCount('error') === 1) {
              this.logger.error({ err }, 'unhandled response body error')
            }
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
