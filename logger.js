const serializers = require('./serializers')
const pino = require('pino')

const isProduction = process.env.NODE_ENV === 'production'

module.exports.createLogger = function ({
  extreme = isProduction,
  prettyPrint = !isProduction,
  level = isProduction ? 'info' : 'trace',
  flushInterval = 1000,
  stream,
  ...options
} = {}, onTerminate) {
  const finalHandler = async (err, finalLogger, evt) => {
    finalLogger.info(`${evt} caught`)
    if (err) {
      finalLogger.error({ err }, 'error caused exit')
      process.exit(1)
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

  if (!extreme) {
    logger = pino({ serializers, prettyPrint, level, ...options }, stream)
    handler = (err, evt) => finalHandler(err, logger, evt)
  } else {
    logger = pino({ serializers, prettyPrint, level, ...options }, stream || pino.extreme())
    handler = pino.final(logger, finalHandler)
    setInterval(() => {
      logger.flush()
    }, flushInterval).unref()
  }

  process.on('beforeExit', () => handler(null, 'beforeExit'))
  process.on('exit', () => handler(null, 'exit'))
  process.on('uncaughtException', err => handler(err, 'uncaughtException'))
  process.on('unhandledRejection', err => handler(err, 'unhandledRejection'))
  process.on('SIGINT', () => handler(null, 'SIGINT'))
  process.on('SIGQUIT', () => handler(null, 'SIGQUIT'))
  process.on('SIGTERM', () => handler(null, 'SIGTERM'))

  return logger
}
