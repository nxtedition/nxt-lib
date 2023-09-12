const assert = require('assert')
const createError = require('http-errors')
const xuid = require('xuid')
const { readableStreamLength } = require('../stream')
const undici = require('undici')
const stream = require('stream')
const { parseHeaders } = require('../http')
const RetryHandler = require('./retry-handler')
const DumpHandler = require('./dump-handler')

class Readable extends stream.Readable {
  constructor({ statusCode, statusMessage, headers, ...opts }) {
    super(opts)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
    this.headers = headers
  }
}

module.exports = async function request(
  url,
  {
    logger,
    id = xuid(),
    retry,
    redirect,
    path,
    origin,
    maxRedirections: _maxRedirections,
    dispatcher = undici.getGlobalDispatcher(),
    idempotent,
    signal,
    headersTimeout,
    bodyTimeout,
    reset = false,
    body,
    method = body ? 'POST' : 'GET',
    userAgent,
    headers,
    dump = method === 'HEAD',
  },
) {
  assert(!path)
  assert(!origin)

  url = new URL(url)

  if (retry === false) {
    retry = { count: 0 }
  } else if (typeof retry === 'number') {
    retry = { count: retry }
  }

  if (redirect === false) {
    redirect = { count: 0 }
  } else if (typeof redirect === 'number') {
    redirect = { count: redirect }
  }

  const { count: redirectMax = 3 } = redirect ?? { count: _maxRedirections }

  if (readableStreamLength(body) === 0) {
    body.on('error', () => {})
    body = null
  }

  const ureq = {
    url,
    method,
    body,
    headers: {
      'request-id': id,
      'user-agent': userAgent,
      ...headers,
    },
    origin: url.origin,
    path: url.search ? `${url.pathname}${url.search}` : url.pathname,
    reset,
    headersTimeout,
    bodyTimeout,
    idempotent,
    signal,
    maxRedirections: redirectMax,
    // nxt
    retry,
    redirect,
  }

  logger = logger?.child({ ureq })
  logger?.debug('upstream request started')

  return new Promise((resolve, reject) => {
    let handler = {
      resolve,
      reject,
      body: null,
      abort: null,
      signal,
      position: 0,
      logger,
      onConnect(abort) {
        if (this.signal.aborted) {
          abort(this.signal.reason)
        } else {
          this.abort = abort
          this.signal?.addEventListener('abort', this.abort)
        }
      },
      onHeaders(statusCode, rawHeaders, resume, statusMessage) {
        const headers = parseHeaders(rawHeaders)

        if (statusCode >= 300) {
          throw createError(statusCode, { headers })
        }

        this.logger = this.logger?.child({ ures: { headers, statusCode } })
        this.logger?.debug('upstream request response')

        this.body = new Readable({
          read: resume,
          highWaterMark: 128 * 1024,
          statusCode,
          statusMessage,
          headers,
        })

        this.resolve(this.body)

        return true
      },
      onData(chunk) {
        this.position += chunk.length
        return this.body.push(chunk)
      },
      onComplete() {
        this.signal?.removeEventListener('abort', this.abort)

        this.logger?.debug({ err }, 'upstream response completed')

        this.body.push(null)
      },
      onError(err) {
        this.signal?.removeEventListener('abort', this.abort)

        if (this.signal.aborted || err.name === 'AbortError') {
          this.logger?.debug({ err }, 'upstream response aborted')
        } else {
          this.logger?.error({ err }, 'upstream response failed')
        }

        this.reject(err)
      },
    }

    if (retry) {
      handler = new RetryHandler(ureq, { handler, dispatcher })
    }

    if (dump) {
      handler = new DumpHandler(ureq, { handler })
    }

    dispatcher.dispatch(ureq, handler)
  })
}
