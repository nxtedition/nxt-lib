const serializers = require('./serializers')
const pino = require('pino')
const { isMainThread } = require('node:worker_threads')

const isProduction = process.env.NODE_ENV === 'production'

module.exports.createLogger = function (
  {
    extreme = isProduction,
    level = isProduction ? 'debug' : 'trace',
    flushInterval = 1e3,
    stream = null,
    ...options
  } = {},
  onTerminate,
) {
  if (!stream) {
    if (
      process.stdout.write !== process.stdout.constructor.prototype.write ||
      process.stdout.fd == null
    ) {
      stream = process.stdout
    }
  }

  if (stream) {
    // Do nothing...
  } else if (!extreme) {
    stream = pino.destination({ fd: process.stdout.fd ?? 1, sync: true })
  } else if (!isMainThread) {
    // TODO (fix): Async logging?
    stream = pino.destination({ fd: 1, sync: true })
  } else {
    stream = pino.destination({ sync: false, minLength: 4096 })
    setInterval(() => {
      logger.flush()
    }, flushInterval).unref()
  }

  const logger = pino(
    {
      level,
      ...options,
      serializers: {
        ...serializers,
        ...options.serializers,
      },
    },
    stream,
  )

  let called = false
  const finalHandler = async (err, evt) => {
    if (called) {
      return
    }
    called = true

    if (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      logger.fatal({ err }, evt || 'error caused exit')

      if (stream?.flushSync) {
        stream.flushSync()
      }

      process._rawDebug(err.stack)

      process.exit(1)
    } else {
      logger.info(`${evt} caught`)
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
      logger.info({ exitSignal }, 'exit')
      process.exit(!exitSignal ? 0 : exitSignal)
    }
  }

  process.on('exit', () => finalHandler(null, 'exit'))
  process.on('beforeExit', () => finalHandler(null, 'beforeExit'))
  process.on('SIGINT', () => finalHandler(null, 'SIGINT'))
  process.on('SIGQUIT', () => finalHandler(null, 'SIGQUIT'))
  process.on('SIGTERM', () => finalHandler(null, 'SIGTERM'))
  process.on('uncaughtException', (err, origin) => finalHandler(err, origin))

  return logger
}
