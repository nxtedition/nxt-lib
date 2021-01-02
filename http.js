const xuid = require('xuid')
const createError = require('http-errors')
const { performance } = require('perf_hooks')
const EE = require('events')
const requestTarget = require('request-target')
const querystring = require('querystring')

const kAbort = Symbol('abort')
const kAborted = Symbol('aborted')

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

  // Normalize OutgoingMessage.destroyed
  res.on('close', () => {
    res.destroyed = true
    signal[kAbort]()
  })

  res.setHeader('request-id', req.id)

  const reqLogger = logger.child({ req })
  try {
    reqLogger.debug({ req }, 'request started')

    await Promise.all([
      next(),
      new Promise((resolve, reject) => req
        .on('close', resolve)
        .on('aborted', resolve)
        .on('error', reject)
        .on('timeout', () => {
          reject(new createError.RequestTimeout())
        })
      ),
      new Promise((resolve, reject) => res
        .on('close', resolve)
        .on('finish', resolve)
        .on('error', reject)
        .on('timeout', () => {
          reject(new createError.RequestTimeout())
        })
      )
    ])

    const responseTime = performance.now() - startTime
    if (req.aborted) {
      reqLogger.debug({ res, responseTime }, 'request aborted')
    } else if (res.statusCode >= 500) {
      throw createError(res.statusCode, res.message)
    } else if (res.statusCode >= 400) {
      reqLogger.warn({ res, responseTime }, 'request failed')
    } else {
      reqLogger.debug({ res, responseTime }, 'request completed')
    }
  } catch (err) {
    const statusCode = err.statusCode || 500
    const responseTime = Math.round(performance.now() - startTime)

    signal[kAbort]()

    req.on('error', err => {
      reqLogger.warn({ err }, 'request error')
    })
    res.on('error', err => {
      reqLogger.warn({ err }, 'request error')
    })

    if (!res.headersSent && !res.finished) {
      for (const name of res.getHeaderNames()) {
        res.removeHeader(name)
      }

      res.setHeader('request-id', req.id)

      if (err.headers) {
        for (const [key, val] of Object.entries(err.headers)) {
          if (
            key.toLowerCase() !== 'content-length' &&
            key.toLowerCase() !== 'content-type' &&
            key.toLowerCase() !== 'transfer-encoding' &&
            key.toLowerCase() !== 'connection' &&
            key.toLowerCase() !== 'keep-alive' &&
            key.toLowerCase() !== 'upgrade'
          ) {
            res.setHeader(key, val)
          }
        }
      }
      res.statusCode = statusCode
      res.end()
    } else {
      res.destroy(err)
    }

    if (statusCode < 500) {
      reqLogger.warn({ err, res, responseTime }, 'request failed')
    } else {
      reqLogger.error({ err, res, responseTime }, 'request error')
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

  socket.on('close', () => {
    signal[kAbort]()
  })

  const reqLogger = logger.child({ req })
  try {
    reqLogger.debug('stream started')

    await next()

    if (!socket.destroyed) {
      await new Promise((resolve, reject) => {
        req
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
        socket
          .on('error', reject)
          .on('close', resolve)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
      })
    }

    reqLogger.debug('stream completed')
  } catch (err) {
    const statusCode = err.statusCode || 500

    signal[kAbort]()

    req.on('error', err => {
      reqLogger.warn({ err }, 'stream error')
    })
    socket.on('error', err => {
      reqLogger.warn({ err }, 'stream error')
    })

    socket.destroy(err)

    if (statusCode < 500) {
      reqLogger.warn({ err, res }, 'stream failed')
    } else {
      reqLogger.error({ err, res }, 'stream error')
    }
  }
}

module.exports.createHttpHeader = createHttpHeader

function createHttpHeader (line, headers) {
  let head = line
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (!Array.isArray(value)) {
        head += `\r\n${key}: ${value}`
      } else {
        for (let i = 0; i < value.length; i++) {
          head += `\r\n${key}: ${value[i]}`
        }
      }
    }
  }
  head += '\r\n\r\n'
  return Buffer.from(head, 'ascii')
}
