const xuid = require('xuid')
const statuses = require('statuses')
const createError = require('http-errors')

module.exports.request = async function request (ctx, next) {
  const { req, res, logger } = ctx
  const startTime = Date.now()

  try {
    req.id = req.id || req.headers['request-id'] || xuid()
    req.log = logger.child({ req: { id: req.id } })
    req.log.debug({ req }, 'request started')

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

    const responseTime = Date.now() - startTime
    if (req.aborted) {
      req.log.debug({ res, responseTime }, 'request aborted')
    } else if (res.statusCode >= 500) {
      throw createError(res.statusCode, res.message)
    } else if (res.statusCode >= 400) {
      req.log.warn({ res, responseTime }, 'request failed')
    } else {
      req.log.debug({ res, responseTime }, 'request completed')
    }
  } catch (err) {
    const statusCode = err.statusCode || 500
    const responseTime = Date.now() - startTime

    res.log = req.log || logger
    res.on('error', function (err) {
      this.log.warn({ err }, 'request error')
    })

    if (!res.headersSent && !res.finished && res.writable) {
      for (const name of res.getHeaderNames()) {
        res.removeHeader(name)
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
      res.log.warn({ err, res, responseTime }, 'request failed')
    } else {
      res.log.error({ err, res, responseTime }, 'request error')
    }
  }
}

module.exports.upgrade = async function upgrade (ctx, next) {
  const { req, res, socket = res, logger } = ctx

  try {
    req.id = req.id || req.headers['request-id'] || xuid()
    req.log = logger.child({ req })
    req.log.debug('stream started')

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

    req.log.debug('stream completed')
  } catch (err) {
    const statusCode = err.statusCode || 500

    socket.log = req.log || logger
    socket.on('error', function (err) {
      this.log.warn({ err }, 'stream error')
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
      socket.log.warn({ err, res }, 'stream failed')
    } else {
      socket.log.error({ err, res }, 'stream error')
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
