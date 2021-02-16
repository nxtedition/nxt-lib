/* globals AbortController */

const xuid = require('xuid')
const createError = require('http-errors')
const { performance } = require('perf_hooks')
const requestTarget = require('request-target')
const querystring = require('querystring')
const assert = require('assert')

const ERR_HEADER_EXPR = /^(content-length|content-type|te|host|upgrade|trailers|connection|keep-alive|http2-settings|transfer-encoding|proxy-connection|proxy-authenticate|proxy-authorization)$/i

module.exports.request = async function request (ctx, next) {
  const { req, res, logger } = ctx
  const startTime = performance.now()

  const ac = new AbortController()
  const signal = ac.signal

  ctx.id = req.id = req.headers['request-id'] || xuid()
  ctx.logger = req.log = logger.child({ req })
  ctx.signal = signal
  ctx.url = requestTarget(req)
  ctx.query = ctx.url?.search
    ? querystring.parse(ctx.url.search.slice(1))
    : null

  if (!ctx.url) {
    throw new createError.BadRequest()
  }

  res.setHeader('request-id', req.id)

  let reqLogger = logger.child({ req })
  try {
    reqLogger.debug('request started')

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
      ac.abort()
    }

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
    const statusCode = res.headersSent
      ? res.statusCode
      : err.statusCode || 500

    const responseTime = Math.round(performance.now() - startTime)

    reqLogger = reqLogger.child({ res })

    if (res.destroyed && res.writableEnded === false) {
      reqLogger.debug({ err, statusCode, responseTime }, 'request aborted')
    } if (statusCode < 500) {
      reqLogger.warn({ err, statusCode, responseTime }, 'request failed')
    } else {
      reqLogger.error({ err, statusCode, responseTime }, 'request error')
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

  const ac = new AbortController()
  const signal = ac.signal

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
      signal.abort()
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
