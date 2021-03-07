const serializers = require('./serializers')
const pino = require('pino')
const { isMainTread } = require('worker_threads')

const isProduction = process.env.NODE_ENV === 'production'

module.exports.createLogger = function (
  {
    extreme = isProduction,
    prettyPrint = isProduction ? null : { translateTime: true },
    level = isProduction ? 'info' : 'trace',
    flushInterval = 2e3,
    stream,
    ...options
  } = {},
  onTerminate
) {
  let called = false
  const finalHandler = async (err, finalLogger, evt) => {
    if (called) {
      return
    }
    called = true

    finalLogger.info(`${evt} caught`)
    if (err) {
      finalLogger.fatal({ err }, 'error caused exit')
      if (stream && stream.flushSync) {
        stream.flushSync()
      }
      if (isMainTread === false) {
        process.exit(1)
      } else {
        throw err
      }
    } else {
      let exitSignal
      try {
        exitSignal = onTerminate ? await onTerminate(finalLogger) : null
      } catch (err) {
        exitSignal = err.exitSignal || 1
        finalLogger.warn({ err })
      }
      process.exit(!exitSignal ? 0 : exitSignal)
    }
  }

  let logger
  let handler

  if (
    !stream &&
    (process.stdout.write !== process.stdout.constructor.prototype.write || !process.stdout.fd)
  ) {
    stream = process.stdout
  }

  if (!extreme || (stream && !stream.flushSync)) {
    stream = stream || pino.destination()
    logger = pino({ serializers, prettyPrint, level, ...options }, stream)
    handler = (err, evt) => finalHandler(err, logger, evt)
  } else {
    stream = stream || pino.destination({ sync: false, minLength: 4096 })
    logger = pino({ serializers, prettyPrint, level, ...options }, stream)
    handler = pino.final(logger, finalHandler)
    setInterval(() => {
      logger.flush()
    }, flushInterval).unref()
  }

  process.on('beforeExit', () => handler(null, 'beforeExit'))
  process.on('exit', () => handler(null, 'exit'))
  process.on('uncaughtException', (err) => handler(err, 'uncaughtException'))
  process.on('unhandledRejection', (err) => handler(err, 'uncaughtException'))
  process.on('SIGINT', () => handler(null, 'SIGINT'))
  process.on('SIGQUIT', () => handler(null, 'SIGQUIT'))
  process.on('SIGTERM', () => handler(null, 'SIGTERM'))

  return logger
}
