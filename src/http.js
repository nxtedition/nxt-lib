const xuid = require('xuid')
const statuses = require('statuses')
const createError = require('http-errors')

function patchReqRes (obj) {
  if (obj.closed === undefined) {
    obj.closed = false
    obj.on('close', function () {
      this.closed = true
    })
  }

  if (obj.complete === undefined) {
    Object.defineProperty(obj, 'complete', {
      get: function complete () {
        return Boolean(
          this.finished ||
          this.aborted ||
          this.closed ||
          (this._writableState && (this._writableState.ended || this._writableState.destroyed)) ||
          (this._readableState && (this._readableState.ended || this._readableState.destroyed)) ||
          (this.stream && (this.stream.ended || this.stream.destroyed || this.stream.aborted))
        )
      }
    })
  }
}

module.exports.request = async function request (ctx, next) {
  const { req, res, logger } = ctx
  const startTime = Date.now()

  try {
    req.id = req.id || req.headers['request-id'] || xuid()
    req.log = logger.child({ req })
    req.log.debug('request started')

    res.setHeader('request-id', req.id)

    patchReqRes(req)
    patchReqRes(res)

    await Promise.all([
      next(),
      new Promise((resolve, reject) => {
        req
          .on('close', resolve)
          .on('aborted', resolve)
          .on('error', reject)
          .on('timeout', () => {
            reject(new createError.RequestTimeout())
          })
        res
          .on('close', resolve)
          .on('finish', resolve)
          .on('error', reject)
      })
    ])

    const responseTime = Date.now() - startTime
    req.log.debug({ res, responseTime }, `request ${req.aborted ? 'aborted' : 'completed'}`)
  } catch (err) {
    const statusCode = err.statusCode || 500
    const responseTime = Date.now() - startTime

    res.log = req.log || logger
    res.on('error', function (err) {
      this.log.warn({ err }, 'request error')
    })

    if (!res.headersSent && !res.finished && res.writable) {
      if (statusCode >= 500) {
        for (const name of res.getHeaderNames()) {
          res.removeHeader(name)
        }
      }
      res.statusCode = statusCode
      res.end()
    } else {
      res.destroy()
    }

    if (statusCode >= 400 && statusCode < 500) {
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

    req.log.debug(`stream completed`)
  } catch (err) {
    const statusCode = err.statusCode || 500

    socket.log = req.log || logger
    socket.on('error', function (err) {
      this.log.warn({ err }, 'stream error')
    })

    if (statusCode >= 400 && statusCode < 500) {
      socket.log.warn({ err }, 'stream failed')
    } else {
      socket.log.error({ err }, 'stream error')
    }

    if (socket.writable) {
      socket.end(Buffer.from(`HTTP/1.1 ${statusCode} ${statuses[statusCode]}\r\n\r\n`, 'ascii'))
    } else {
      socket.destroy()
    }
  }
}
