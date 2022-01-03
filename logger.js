const serializers = require('./serializers')
const pino = require('pino')

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
  if (
    !stream &&
    (process.stdout.write !== process.stdout.constructor.prototype.write || !process.stdout.fd)
  ) {
    stream = process.stdout
  }

  if (stream) {
    // Do nothing...
  } else if (!extreme) {
    stream = pino.destination({ fd: process.stdout.fd, sync: true })
  } else {
    stream = pino.destination({ fd: process.stdout.fd, sync: false, minLength: 4096 })
    setInterval(() => {
      logger.flush()
    }, flushInterval).unref()
  }

  const logger = pino(
    {
      serializers,
      transport: prettyPrint
        ? {
            target: 'pino-pretty',
          }
        : null,
      level,
      ...options,
    },
    stream
  )

  let called = false
  const finalHandler = async (err, evt) => {
    if (called) {
      return
    }
    called = true

    logger.info(`${evt} caught`)
    if (err) {
      logger.fatal({ err }, 'error caused exit')
      if (stream?.flushSync) {
        stream.flushSync()
      }
      process.exit(1)
    } else {
      let exitSignal
      try {
        exitSignal = onTerminate ? await onTerminate(logger) : null
      } catch (err) {
        exitSignal = err.exitSignal || 1
        logger.warn({ err })
      }
      if (stream?.flushSync) {
        stream.flushSync()
      }
      process.exit(!exitSignal ? 0 : exitSignal)
    }
  }

  process.on('exit', () => finalHandler(null, 'exit'))
  process.on('beforeExit', () => finalHandler(null, 'beforeExit'))
  process.on('SIGINT', () => finalHandler(null, 'SIGINT'))
  process.on('SIGQUIT', () => finalHandler(null, 'SIGQUIT'))
  process.on('SIGTERM', () => finalHandler(null, 'SIGTERM'))
  process.on('uncaughtException', (err) => finalHandler(err, 'uncaughtException'))
  process.on('unhandledRejection', (err) => finalHandler(err, 'unhandledRejection'))

  return logger
}
