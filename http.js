const createError = require('http-errors')
const { performance } = require('perf_hooks')
const requestTarget = require('request-target')
const querystring = require('querystring')
const assert = require('assert')
const AbortController = require('abort-controller')
const { AbortError } = require('./errors')

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
  return nextReqId.toString(36)
}

module.exports.request = async function request(ctx, next) {
  const { req, res, logger } = ctx
  const startTime = performance.now()

  const ac = new AbortController()
  const signal = ac.signal

  ctx.id = req.id = req.headers['request-id'] || genReqId()
  ctx.logger = req.log = logger.child({ req: { id: req.id, method: req.method, url: req.url } })
  ctx.signal = signal
  ctx.method = req.method
  ctx.url = requestTarget(req)
  ctx.query = ctx.url?.search ? querystring.parse(ctx.url.search.slice(1)) : null

  res.setHeader('request-id', req.id)

  let reqLogger = ctx.logger
  try {
    reqLogger.debug({ req }, 'request started')

    if (!ctx.url) {
      throw new createError.BadRequest()
    }

    await Promise.all([
      new Promise((resolve, reject) =>
        req
          .on('close', resolve)
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
      ),
      new Promise((resolve, reject) =>
        res
          .on('close', function () {
            // Normalize OutgoingMessage.destroyed
            this.destroyed = true

            if (this.writableEnded === false) {
              reject(new AbortError())
            } else {
              resolve()
            }
          })
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
      ),
      next(),
    ])

    assert(res.writableEnded)
    assert(res.statusCode)

    const responseTime = Math.round(performance.now() - startTime)

    reqLogger = reqLogger.child({ res })

    if (res.statusCode >= 500) {
      reqLogger.error({ responseTime }, 'request error')
    } else if (res.statusCode >= 400) {
      reqLogger.warn({ responseTime }, 'request failed')
    } else {
      reqLogger.debug({ responseTime }, 'request completed')
    }
  } catch (err) {
    const statusCode = res.headersSent ? res.statusCode : err.statusCode || 500

    const responseTime = Math.round(performance.now() - startTime)

    if (!res.headersSent) {
      for (const name of res.getHeaderNames()) {
        res.removeHeader(name)
      }

      res.setHeader('request-id', req.id)

      if (err.headers) {
        assert(typeof err.headers === 'object')

        for (const [key, val] of Object.entries(err.headers)) {
          if (!ERR_HEADER_EXPR.test(key)) {
            res.setHeader(key, val)
          }
        }
      }

      res.statusCode = statusCode
      res.end()
    } else {
      res.destroy(err)
    }

    reqLogger = reqLogger.child({ res })

    if (req.aborted || err.name === 'AbortError') {
      reqLogger.info(
        { err: err ?? createError(statusCode), statusCode, responseTime },
        'request aborted'
      )
    } else if (statusCode < 500) {
      reqLogger.warn(
        { err: err ?? createError(statusCode), statusCode, responseTime },
        'request failed'
      )
    } else {
      reqLogger.error(
        { err: err ?? createError(statusCode), statusCode, responseTime },
        'request error'
      )
    }

    req.on('error', (err) => {
      if (statusCode > 500 || err.code !== 'ECONNRESET') {
        reqLogger.warn({ err }, 'request error')
      }
    })
    res.on('error', (err) => {
      reqLogger.warn({ err }, 'request error')
    })
  } finally {
    queueMicrotask(() => ac.abort())
  }
}

module.exports.upgrade = async function upgrade(ctx, next) {
  const { req, res, socket = res, logger } = ctx

  const ac = new AbortController()
  const signal = ac.signal

  ctx.id = req.id = req.headers['request-id'] || genReqId()
  ctx.logger = req.log = logger.child({ req: { id: req.id, method: req.method, url: req.url } })
  ctx.signal = signal
  ctx.url = requestTarget(req)
  ctx.query = ctx.url?.search ? querystring.parse(ctx.url.search.slice(1)) : null

  let aborted = false
  const reqLogger = logger.child({ req })
  try {
    reqLogger.debug('stream started')

    if (!ctx.url) {
      throw new createError.BadRequest()
    }

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
          })
      ),
      new Promise((resolve, reject) =>
        socket
          .on('close', resolve)
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
      ),
      next(),
    ])

    reqLogger.debug('stream completed')
  } catch (err) {
    const statusCode = err.statusCode || 500

    if (aborted || err.name === 'AbortError') {
      reqLogger.warn({ err, res }, 'stream aborted')
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
