const createError = require('http-errors')
const { performance } = require('perf_hooks')
const requestTarget = require('request-target')
const querystring = require('fast-querystring')
const assert = require('assert')
const compose = require('koa-compose')
const http = require('http')
const fp = require('lodash/fp')
const tp = require('timers/promises')

const ERR_HEADER_EXPR =
  /^(content-length|content-type|te|host|upgrade|trailers|connection|keep-alive|http2-settings|transfer-encoding|proxy-connection|proxy-authenticate|proxy-authorization)$/i

// https://github.com/fastify/fastify/blob/main/lib/reqIdGenFactory.js
// 2,147,483,647 (2^31 − 1) stands for max SMI value (an internal optimization of V8).
// With this upper bound, if you'll be generating 1k ids/sec, you're going to hit it in ~25 days.
// This is very likely to happen in real-world applications, hence the limit is enforced.
// Growing beyond this value will make the id generation slower and cause a deopt.
// In the worst cases, it will become a float, losing accuracy.
const maxInt = 2147483647
let nextReqId = Math.floor(Math.random() * maxInt)
function genReqId() {
  nextReqId = (nextReqId + 1) & maxInt
  return `req-${nextReqId.toString(36)}`
}

module.exports.request = async function request(ctx, next) {
  const { req, res, logger } = ctx
  const startTime = performance.now()

  const ac = new AbortController()
  const signal = ac.signal

  let reqLogger = logger
  try {
    ctx.url = requestTarget(req)
    if (!ctx.url) {
      throw new createError.BadRequest('invalid url')
    }

    ctx.id = req.id = req.headers['request-id'] || genReqId()
    ctx.logger = req.log = logger.child({ req })
    ctx.signal = signal
    ctx.method = req.method
    ctx.query = ctx.url.search ? querystring.parse(ctx.url.search.slice(1)) : {}

    if (req.method === 'GET' || req.method === 'HEAD') {
      req.resume() // Dump the body if there is one.
    }

    res.setHeader('request-id', req.id)

    const isHealthcheck = ctx.url.pathname === '/healthcheck'

    reqLogger = ctx.logger
    if (!isHealthcheck) {
      reqLogger.debug({ req }, 'request started')
    } else {
      reqLogger.trace({ req }, 'request started')
    }

    await Promise.all([
      next(),
      new Promise((resolve, reject) => {
        res
          .on('timeout', function () {
            this.destroy(new createError.RequestTimeout())
          })
          .on('error', (err) => {
            reqLogger.error({ err }, 'response error')
            reject(err)
          })
          .on('close', () => {
            reqLogger.debug('response closed')
            if (!res.writableEnded) {
              reject(
                Object.assign(new Error('response closed prematurely'), {
                  code: 'ERR_STREAM_PREMATURE_CLOSE',
                }),
              )
            } else {
              resolve(null)
            }
          })
        req
          .on('timeout', function () {
            this.destroy(new createError.RequestTimeout())
          })
          .on('error', (err) => {
            reqLogger.error({ err }, 'request error')
          })
          .on('close', () => {
            reqLogger.debug('request closed')
          })
      }),
    ])

    assert(res.writableEnded)
    assert(res.statusCode)

    const responseTime = Math.round(performance.now() - startTime)

    reqLogger = reqLogger.child({ res, responseTime })

    if (res.statusCode >= 500) {
      reqLogger.error('request error')
    } else if (res.statusCode >= 400) {
      reqLogger.warn('request failed')
    } else if (!isHealthcheck) {
      reqLogger.debug('request completed')
    } else {
      reqLogger.trace('request completed')
    }

    ac.abort()
  } catch (err) {
    const reason = ac.signal.reason
    const responseTime = Math.round(performance.now() - startTime)

    req.on('error', (err) => {
      if (res.statusCode > 500 || err.code !== 'ECONNRESET') {
        reqLogger.warn({ err }, 'request error')
      }
    })

    res.on('error', (err) => {
      reqLogger.warn({ err }, 'request error')
    })

    if (!res.headersSent && !res.destroyed) {
      res.statusCode = err.statusCode || 500

      let reqId = req?.id || err.id
      for (const name of res.getHeaderNames()) {
        if (!reqId && name === 'request-id') {
          reqId = res.getHeader(name)
        }
        res.removeHeader(name)
      }

      if (reqId) {
        res.setHeader('request-id', reqId)
      }

      if (fp.isPlainObject(err.headers)) {
        for (const [key, val] of Object.entries(err.headers)) {
          if (!ERR_HEADER_EXPR.test(key)) {
            res.setHeader(key, val)
          }
        }
      }

      if (fp.isPlainObject(err.body)) {
        res.setHeader('content-type', 'application/json')
        res.write(JSON.stringify(err.body))
      }

      reqLogger = reqLogger.child({ res, err, reason, responseTime })

      if (res.statusCode < 500) {
        reqLogger.warn('request failed')
      } else {
        reqLogger.error('request error')
      }

      reqLogger.debug('request ended')

      res.end()
    } else {
      reqLogger = reqLogger.child({ res, err, reason, responseTime })

      if (req.aborted || err.name === 'AbortError') {
        reqLogger.debug('request aborted')
      } else if (err.statusCode < 500) {
        reqLogger.warn('request failed')
      } else {
        reqLogger.error('request error')
      }

      if (res.writableEnded) {
        reqLogger.debug('response completed')
      } else {
        reqLogger.debug('response destroyed')
        res.destroy()
      }
    }

    ac.abort(err)
  }
}

class ServerResponse extends http.ServerResponse {
  constructor(req) {
    super(req)
    this.startTime = performance.now()
    this.stats = {
      headers: -1,
      ttfb: -1,
    }
  }

  flushHeaders() {
    if (this.stats.headers === -1) {
      this.stats.headers = performance.now() - this.startTime
    }
    return super.flushHeaders()
  }

  write(chunk, encoding, callback) {
    if (this.stats.ttfb === -1) {
      this.stats.ttfb = performance.now() - this.startTime
    }
    if (this.stats.headers === -1) {
      this.stats.headers = this.stats.ttfb
    }
    return super.write(chunk, encoding, callback)
  }

  end(chunk, encoding, callback) {
    if (this.stats.ttfb === -1) {
      this.stats.ttfb = performance.now() - this.startTime
    }
    if (this.stats.headers === -1) {
      this.stats.headers = this.stats.ttfb
    }
    return super.end(chunk, encoding, callback)
  }
}

module.exports.ServerResponse = ServerResponse

module.exports.createServer = function (options, ctx, middleware) {
  middleware = Array.isArray(middleware) ? middleware : [middleware]
  middleware = fp.values(middleware)
  middleware = middleware.flat().filter(Boolean)
  middleware = compose([module.exports.request, ...middleware])

  const factory = typeof ctx === 'function' ? ctx : () => ctx

  const server = http.createServer(
    {
      ServerResponse,
      keepAliveTimeout: 2 * 60e3,
      headersTimeout: 2 * 60e3,
      requestTimeout: 0,
      ...options,
    },
    (req, res) => middleware({ req, res, ...factory() }),
  )

  server.setTimeout(2 * 60e3)

  if (options?.signal?.aborted) {
    queueMicrotask(() => server.close())
  } else {
    options?.signal?.addEventListener('abort', () => server.close())
  }

  return server
}

module.exports.upgrade = async function upgrade(ctx, next) {
  const { req, res, socket = res, logger } = ctx

  const ac = new AbortController()
  const signal = ac.signal

  let aborted = false
  let reqLogger = logger
  try {
    ctx.url = requestTarget(req)
    if (!ctx.url) {
      throw new createError.BadRequest('invalid url')
    }

    ctx.id = req.id = req.headers['request-id'] || genReqId()
    ctx.logger = req.log = logger.child({ req })
    ctx.signal = signal
    ctx.query = ctx.url?.search ? querystring.parse(ctx.url.search.slice(1)) : {}

    reqLogger = logger
    reqLogger.debug('stream started')

    socket.on('error', (err) => {
      // NOTE: Special case where the client becomes unreachable.
      if (err.message.startsWith('read ')) {
        aborted = true
      }
    })

    await Promise.all([
      new Promise((resolve, reject) =>
        req
          .on('close', resolve)
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          }),
      ),
      new Promise((resolve, reject) =>
        socket
          .on('close', resolve)
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          }),
      ),
      next(),
    ])

    reqLogger.debug('stream completed')
  } catch (err) {
    const statusCode = err.statusCode || 500

    if (aborted || err.name === 'AbortError' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      reqLogger.debug({ err, res }, 'stream aborted')
    } else if (statusCode < 500) {
      reqLogger.warn({ err, res }, 'stream failed')
    } else {
      reqLogger.error({ err, res }, 'stream error')
    }

    req.on('error', (err) => {
      reqLogger.warn({ err }, 'stream error')
    })
    socket.on('error', (err) => {
      reqLogger.warn({ err }, 'stream error')
    })

    socket.destroy(err)
  } finally {
    queueMicrotask(() => ac.abort())
  }
}

function isConnectionError(err) {
  // AWS compat.
  const statusCode = err?.statusCode ?? err?.$metadata?.httpStatusCode
  return err
    ? err.code === 'ECONNRESET' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ENOTFOUND' ||
        err.code === 'ENETDOWN' ||
        err.code === 'ENETUNREACH' ||
        err.code === 'EHOSTDOWN' ||
        err.code === 'EHOSTUNREACH' ||
        err.code === 'EPIPE' ||
        err.message === 'other side closed' ||
        statusCode === 420 ||
        statusCode === 429 ||
        statusCode === 502 ||
        statusCode === 503 ||
        statusCode === 504
    : false
}

function defaultDelay(err, retryCount, options) {
  const { signal, logger = null } = options ?? {}
  if (isConnectionError(err)) {
    const delay =
      parseInt(err.headers?.['Retry-After']) * 1e3 || Math.min(10e3, retryCount * 1e3 + 1e3)
    logger?.warn({ err, retryCount, delay }, 'retrying')
    return tp.setTimeout(delay, undefined, { signal })
  } else {
    throw err
  }
}

module.exports.delay = defaultDelay
module.exports.isConnectionError = isConnectionError

module.exports.retry = async function _retry(fn, options) {
  const { maxRetries = 8, count = maxRetries, delay = defaultDelay, signal } = options ?? {}

  for (let retryCount = 0; true; ++retryCount) {
    try {
      return await fn({ retryCount, signal })
    } catch (err) {
      if (retryCount >= count) {
        throw err
      } else if (typeof delay === 'number') {
        await tp.setTimeout(delay, undefined, options)
      } else if (fp.isFunction(delay)) {
        await delay(err, retryCount, options)
      } else {
        throw err
      }
    }
  }
}

module.exports.parseHeaders = function parseHeaders(rawHeaders, obj = {}) {
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const key = rawHeaders[i].toString().toLowerCase()
    let val = obj[key]
    if (!val) {
      obj[key] = rawHeaders[i + 1].toString()
    } else {
      if (!Array.isArray(val)) {
        val = [val]
        obj[key] = val
      }
      val.push(rawHeaders[i + 1].toString())
    }
  }
  return obj
}
