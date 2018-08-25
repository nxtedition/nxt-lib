const xuid = require('xuid')
const createLogger = require('./logger')
const createError = require('http-errors')

const defaultLogger = createLogger()

module.exports.notFound = () => {
  throw createError.NotFound()
}

module.exports.request = async function request (ctx, next) {
  const { req, res, logger = defaultLogger } = ctx
  const startTime = Date.now()

  try {
    req.id = req.headers['request-id'] || xuid()
    req.log = logger.child({ req })
    req.log.debug('request started')

    res.setHeader('request-id', req.id)

    await next()

    if (!req.aborted && !res.finished) {
      await new Promise((resolve, reject) => {
        req
          .on('close', resolve)
          .on('aborted', resolve)
          .on('error', reject)
        res
          .on('close', resolve)
          .on('finish', resolve)
          .on('error', reject)
      })
    }

    const responseTime = Date.now() - startTime
    req.log.debug({ res, responseTime }, `request ${req.aborted ? 'aborted' : 'completed'}`)
  } catch (err) {
    const responseTime = Date.now() - startTime

    let statusCode = err.statusCode
    if (!statusCode) {
      if (err.code === 'ENOENT') {
        statusCode = 404
      } else if (err.code === 'EEXIST') {
        statusCode = 409
      } else {
        statusCode = 500
      }
    }

    res.log = req.log || logger
    res.on('error', function (err) {
      this.log.warn({ err }, 'request error')
    })

    if (statusCode >= 400 && statusCode < 500) {
      res.log.warn({ err, res, responseTime }, 'request failed')
    } else {
      res.log.error({ err, res, responseTime }, 'request error')
    }

    if (!res.headersSent && !res.finished && res.writable) {
      for (const name of res.getHeaderNames()) {
        res.removeHeader(name)
      }
      res.statusCode = statusCode
      res.end()
    } else {
      res.destroy()
    }
  }
}
