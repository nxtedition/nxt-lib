const xuid = require('xuid')
const createError = require('http-errors')
const { performance } = require('perf_hooks')
const EE = require('events')
const requestTarget = require('request-target')
const querystring = require('querystring')
const assert = require('assert')

const kAbort = Symbol('abort')
const kAborted = Symbol('aborted')

const ERR_HEADER_EXPR = /^(content-length|content-type|te|host|upgrade|trailers|connection|keep-alive|http2-settings|transfer-encoding|proxy-connection|proxy-authenticate|proxy-authorization)$/i

class AbortSignal extends EE {
  constructor () {
    super()
    this[kAborted] = false
  }

  get aborted () {
    return this[kAborted]
  }

  [kAbort] () {
    if (!this[kAborted]) {
      this[kAborted] = true
      this.emit('abort')
    }
  }
}

module.exports.request = async function request (ctx, next) {
  const { req, res, logger } = ctx
  const startTime = performance.now()

  const signal = new AbortSignal()

  ctx.id = req.id = req.headers['request-id'] || xuid()
  ctx.logger = req.log = logger.child({ req: { id: req.id } })
  ctx.signal = signal
  ctx.url = requestTarget(req)
  ctx.query = ctx.url?.search
    ? querystring.parse(ctx.url.search.slice(1))
    : null

  if (!ctx.url) {
    throw new createError.BadRequest()
  }

  res.setHeader('request-id', req.id)

  const reqLogger = logger.child({ req: { id: req.id } })
  try {
    reqLogger.debug({ req }, 'request started')

    try {
      await Promise.all([
        new Promise((resolve, reject) => req
          .on('close', resolve)
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
        ),
        new Promise((resolve, reject) => res
          .on('close', function () {
            // Normalize OutgoingMessage.destroyed
            this.destroyed = true

            if (this.writableEnded === false) {
              reject(new Error('aborted'))
            } else {
              resolve()
            }
          })
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
        ),
        next()
      ])
    } finally {
      signal[kAbort]()
    }

    assert(res.writableEnded)
    assert(res.statusCode)

    const responseTime = Math.round(performance.now() - startTime)

    if (res.statusCode >= 500) {
      reqLogger.error({ res, responseTime }, 'request error')
    } else if (res.statusCode >= 400) {
      reqLogger.warn({ res, responseTime }, 'request failed')
    } else {
      reqLogger.debug({ res, responseTime }, 'request completed')
    }
  } catch (err) {
    const statusCode = res.headersSent
      ? res.statusCode
      : err.statusCode || 500
    const responseTime = Math.round(performance.now() - startTime)

    if (res.destroyed && res.writableEnded === false) {
      reqLogger.debug({ err, res, responseTime }, 'request aborted')
    } if (statusCode < 500) {
      reqLogger.warn({ err, res, responseTime }, 'request failed')
    } else {
      reqLogger.error({ err, res, responseTime }, 'request error')
    }

    req.on('error', err => {
      reqLogger.warn({ err }, 'request error')
    })
    res.on('error', err => {
      reqLogger.warn({ err }, 'request error')
    })

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
  }
}

module.exports.upgrade = async function upgrade (ctx, next) {
  const { req, res, socket = res, logger } = ctx

  const signal = new AbortSignal()

  ctx.id = req.id = req.headers['request-id'] || xuid()
  ctx.logger = req.log = logger.child({ req: { id: req.id } })
  ctx.signal = signal
  ctx.url = requestTarget(req)
  ctx.query = ctx.url?.search
    ? querystring.parse(ctx.url.search.slice(1))
    : null

  if (!ctx.url) {
    throw new createError.BadRequest()
  }

  const reqLogger = logger.child({ req })
  try {
    reqLogger.debug('stream started')

    try {
      await Promise.all([
        new Promise((resolve, reject) => req
          .on('close', resolve)
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
        ),
        new Promise((resolve, reject) => socket
          .on('close', resolve)
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
        ),
        next()
      ])
    } finally {
      signal[kAbort]()
    }

    reqLogger.debug('stream completed')
  } catch (err) {
    const statusCode = err.statusCode || 500

    if (statusCode < 500) {
      reqLogger.warn({ err, res }, 'stream failed')
    } else {
      reqLogger.error({ err, res }, 'stream error')
    }

    req.on('error', err => {
      reqLogger.warn({ err }, 'stream error')
    })
    socket.on('error', err => {
      reqLogger.warn({ err }, 'stream error')
    })

    socket.destroy(err)
  }
}
