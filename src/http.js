const xuid = require('xuid')
const statuses = require('statuses')
const createError = require('http-errors')
const { performance } = require('perf_hooks')

module.exports.request = async function request (ctx, next) {
  const { req, res, logger } = ctx
  const startTime = performance.now()

  req.id = req.id || req.headers['request-id'] || xuid()
  req.log = logger.child({ req: { id: req.id } })

  const reqLogger = logger.child({ req })
  try {
    reqLogger.debug({ req }, 'request started')

    res.setHeader('request-id', req.id)

    await Promise.all([
      next(),
      new Promise((resolve, reject) => {
        function onTimeout () {
          reject(new createError.RequestTimeout())
        }

        req
          .on('close', resolve)
          .on('aborted', resolve)
          .on('error', reject)
          .on('timeout', onTimeout)
        res
          .on('close', resolve)
          .on('finish', resolve)
          .on('error', reject)
          .on('timeout', onTimeout)
      })
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
    const responseTime = performance.now() - startTime

    res.on('error', err => {
      reqLogger.warn({ err }, 'request error')
    })

    if (!res.headersSent && !res.finished) {
      if (statusCode >= 500) {
        for (const name of res.getHeaderNames()) {
          res.removeHeader(name)
        }
      }

      res.setHeader('request-id', req.id)

      if (err.headers) {
        for (const [key, val] of Object.entries(err.headers)) {
          res.setHeader(key, val)
        }
      }
      res.statusCode = statusCode
      res.end()
    } else {
      res.destroy()
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

  const reqLogger = logger.child({ req })
  try {
    req.id = req.id || req.headers['request-id'] || xuid()
    req.log = logger.child({ req: { id: req.id } })
    reqLogger.debug('stream started')

    await next()

    if (!socket.destroyed) {
      await new Promise((resolve, reject) => {
        req
          .on('error', reject)
        socket
          .on('error', reject)
          .on('close', resolve)
      })
    }

    reqLogger.debug('stream completed')
  } catch (err) {
    const statusCode = err.statusCode || 500

    socket.on('error', err => {
      reqLogger.warn({ err }, 'stream error')
    })

    let res = null

    if (socket.writable && !socket.writableEnded) {
      res = {
        statusCode: statusCode,
        headers: err.headers
      }
      // TODO (fix): httpVersion?
      socket.end(createHttpHeader(`HTTP/1.1 ${statusCode} ${statuses[statusCode]}\r\n\r\n`, err.headers))
    } else {
      socket.destroy()
    }

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
