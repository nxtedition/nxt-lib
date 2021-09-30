const serializers = require('./serializers')
const pino = require('pino')
const SonicBoom = require('sonic-boom')

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
    extreme = false
  }

  let logger
  if (!extreme) {
    stream = stream || new SonicBoom({ fd: process.stdout.fd, sync: true })
    logger = pino({ serializers, prettyPrint, level, ...options }, stream)
  } else {
    stream = new SonicBoom({ fd: process.stdout.fd, sync: false, minLength: 4096 })
    logger = pino({ serializers, prettyPrint, level, ...options }, stream)
    setInterval(() => {
      logger.flush()
    }, flushInterval).unref()
  }

  let called = false
  const finalHandler = async (err, evt) => {
    if (called) {
      return
    }
    called = true

    logger.info(`${evt} caught`)
    if (err) {
      logger.fatal({ err }, 'error caused exit')
      if (stream && stream.flushSync) {
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
      if (stream && stream.flushSync) {
        stream.flushSync()
      }
      process.exit(!exitSignal ? 0 : exitSignal)
    }
  }

  process.on('beforeExit', () => finalHandler(null, 'beforeExit'))
  process.on('SIGINT', () => finalHandler(null, 'SIGINT'))
  process.on('SIGQUIT', () => finalHandler(null, 'SIGQUIT'))

  if (extreme) {
    process.on('exit', () => finalHandler(null, 'exit'))
    process.on('uncaughtException', (err) => finalHandler(err, 'uncaughtException'))
    process.on('unhandledRejection', (err) => finalHandler(err, 'unhandledRejection'))
    process.on('SIGTERM', () => finalHandler(null, 'SIGTERM'))
  }

  return logger
}
